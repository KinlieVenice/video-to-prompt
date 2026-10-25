import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  nicheSchema,
  contentIntervals,
  type Niche,
  type ContentPlan,
} from "../app/lib/studio/niche";
import { guidedDefaultsSchema } from "../app/lib/studio/guided";
import { defaultConnection } from "../app/lib/studio/connection";
import {
  defaultVoice,
  type Character,
  type Analysis,
  type Project,
} from "../app/lib/studio/types";
import {
  assetPath,
  getRecord,
  listRecords,
  newAsset,
  saveRecord,
  writeAsset,
} from "../app/lib/studio/server/store";
import { run, probe } from "../app/lib/studio/server/ffmpeg";
import { NicheService } from "../app/lib/studio/services/NicheService";
import { NicheFrameService } from "../app/lib/studio/services/NicheFrameService";
import { PromptGenerationService } from "../app/lib/studio/services/PromptGenerationService";
import { StudioRunService } from "../app/lib/studio/services/StudioRunService";
import {
  FlowJobService,
  type FlowDriver,
} from "../app/lib/studio/services/FlowJobService";
import { VideoAnalysisService } from "../app/lib/studio/services/VideoAnalysisService";
import { GET, POST } from "../app/api/studio/niches/route";
import {
  hookPresets,
  nicheStorySchema,
  storyPrompt,
} from "../app/lib/studio/niche-story";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = path.resolve(".tmp", `niche-test-${randomUUID()}`);
  process.env.STUDIO_DATA_DIR = directory;
  t.after(async () => {
    assert(directory.startsWith(path.resolve(".tmp") + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII=",
    "base64",
  );
  const image = await writeAsset(png, "png");
  const character: Character = {
    id: randomUUID(),
    name: "Reusable performer",
    description: "A distinct user-defined character",
    visualStyle: "Original character style",
    references: [image],
    voice: defaultVoice(),
    updatedAt: new Date().toISOString(),
  };
  await saveRecord("characters", character);
  const reference: Analysis = {
    id: randomUUID(),
    sourceAsset: `${randomUUID()}.mp4`,
    sourceName: "reference.mp4",
    sourceHash: "reference",
    status: "ANALYZED",
    revision: 1,
    createdAt: new Date().toISOString(),
    media: { duration: 10, width: 160, height: 90, fps: 30, hasAudio: false },
    warnings: [],
    speakers: [],
    turns: [],
    activity: [],
    shots: [
      {
        id: "reference-shot",
        start: 0,
        end: 10,
        description: "Distinct reference structure",
        camera: "Tracking close-up",
        lighting: "Warm",
        motion: "Build to a final reveal",
      },
    ],
  };
  await saveRecord("analyses", reference);
  const niche: Niche = {
    id: randomUUID(),
    name: "Story niche",
    description: "A reusable hook, explanation and final reveal format.",
    artStyle: "Watercolor storybook",
    duration: 10,
    language: "Taglish",
    characterId: character.id,
    defaults: guidedDefaultsSchema.parse({}),
    audioMode: "SILENT",
    referenceIds: [reference.id],
    maxCredits: 20,
    updatedAt: new Date().toISOString(),
  };
  await NicheService.save(niche);
  const scene = {
    description: "The main character beside a desk",
    firstFrame: "Standing beside the closed box",
    lastFrame: "Holding the opened box",
    camera: "Fixed close-up",
    lighting: "Soft",
    motion: "0–5s: open the box and react",
    narration: "",
    emotion: "excited",
  };
  const plan: ContentPlan = {
    artStyle: "",
    title: "A new topic",
    hook: "A concise hook",
    summary: "A reveal",
    scenes: [scene, { ...scene, description: "A concluding scene" }],
  };
  const connection = {
    ...defaultConnection(),
    model: "test/script",
    imagesEnabled: true,
  };
  return { niche, reference, character, plan, connection, png, image };
}

test("niche templates validate settings and whole-video allocation independently of reference durations", async (t) => {
  const f = await fixture(t);
  assert.equal(nicheSchema.parse(f.niche).artStyle, "Watercolor storybook");
  assert.throws(() => nicheSchema.parse({ ...f.niche, audioMode: "ORIGINAL" }));
  assert.throws(() => nicheSchema.parse({ ...f.niche, duration: 181 }));
  const intervals = contentIntervals(30, 8);
  assert.equal(intervals.length, 4);
  assert.deepEqual(
    intervals.map((i) => i.end - i.start),
    [8, 8, 8, 6],
  );
  assert.deepEqual(
    contentIntervals(10, 8).map((i) => i.end - i.start),
    [6, 4],
  );
  assert.equal(intervals[0].start, 0);
  assert.equal(intervals.at(-1)!.end, 30);
  assert(intervals.every((i) => i.end - i.start <= 8));
  const many = {
    ...f.reference,
    shots: Array.from({ length: 20 }, (_, i) => ({
      ...f.reference.shots[0],
      id: `shot${i}`,
      description: `Shot ${i}`,
    })),
  };
  const profile = NicheService.referenceProfile(many);
  assert.equal(profile.shots.length, 8);
  assert.equal(profile.shots[0].scene, "Shot 0");
  assert.equal(profile.shots.at(-1)!.scene, "Shot 19");
});

test("one topic reuses reference analyses and cached planning, freezes art style and creates a marked planned timeline", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const service = new NicheService(async (_connection, content) => {
    calls++;
    const text = JSON.stringify(content);
    assert.match(text, /Watercolor storybook/);
    assert.match(text, /Tracking close-up/);
    assert.match(text, /A new topic/);
    assert.match(text, /Uploaded video is the MAIN format reference/);
    assert.match(text, /Sample scripts are SECONDARY/);
    return f.plan;
  });
  const request = randomUUID();
  const video = await service.create(
    f.niche.id,
    "A new topic",
    request,
    f.connection,
  );
  assert.equal(video.state, "READY");
  assert.equal(calls, 1);
  assert.equal(video.plan?.artStyle, f.niche.artStyle);
  assert.equal(
    (await service.create(f.niche.id, "A new topic", request, f.connection))
      .projectId,
    video.projectId,
  );
  assert.equal(calls, 1);
  const project = await getRecord<Project>("projects", video.projectId!);
  const analysis = await getRecord<Analysis>("analyses", project.analysisId);
  assert.equal(analysis.origin, "PLANNED");
  assert.equal(analysis.media.duration, 10);
  assert.equal((await probe(assetPath(analysis.sourceAsset))).duration, 10);
  assert.equal(analysis.shots.length, 2);
  assert.equal(project.versions[0].mappings.main, f.character.id);
  await NicheService.save({ ...f.niche, artStyle: "Flat pixel art" });
  assert.equal(
    (await service.create(f.niche.id, "A new topic", request, f.connection))
      .nicheSnapshot.artStyle,
    "Watercolor storybook",
  );
  assert.equal(
    (await getRecord<Analysis>("analyses", f.reference.id)).revision,
    1,
  );
  await assert.rejects(
    () => VideoAnalysisService.analyze(analysis, f.connection),
    /planned scenes/,
  );
});

test("generated first/last frames preserve identity, use niche art style, cache endpoints and never use the black scaffold", async (t) => {
  const f = await fixture(t);
  const video = await new NicheService(async () => f.plan).create(
    f.niche.id,
    "Frame topic",
    randomUUID(),
    f.connection,
  );
  const project = await getRecord<Project>("projects", video.projectId!);
  const analysis = await getRecord<Analysis>("analyses", project.analysisId);
  const version = project.versions[0];
  const segment = version.segments[0];
  const prompts: string[] = [];
  const frames = new NicheFrameService({
    create: async (input) => {
      prompts.push(input.prompt);
      assert(input.references.every((r) => r.asset !== analysis.sourceAsset));
      assert(input.references.some((r) => r.asset === f.image));
      return writeAsset(f.png, "png");
    },
  });
  const first = await frames.generate(
    analysis,
    version,
    segment,
    [f.character],
    f.niche.defaults.imageModel,
    f.connection,
  );
  await frames.generate(
    analysis,
    version,
    segment,
    [f.character],
    f.niche.defaults.imageModel,
    f.connection,
  );
  assert.equal(prompts.length, 2);
  assert(prompts.every((p) => p.includes("Watercolor storybook")));
  assert.notEqual(first.first, first.last);
  await frames.generate(
    {
      ...analysis,
      contentPlan: { ...analysis.contentPlan!, artStyle: "Flat pixel art" },
    },
    version,
    segment,
    [f.character],
    f.niche.defaults.imageModel,
    f.connection,
  );
  assert.equal(prompts.length, 4);
  const prompt = PromptGenerationService.generate(
    analysis,
    { ...version, audioMode: "FLOW_CLIPS" },
    segment,
    [f.character],
  );
  assert.match(prompt, /Watercolor storybook/);
  assert.match(prompt, /ORIGINAL scripted scene/);
  assert.doesNotMatch(prompt, /Reenact source interval/);
});

test("topic storyboard runs through reference images, fake Flow clips and real FFmpeg final assembly", async (t) => {
  const f = await fixture(t);
  const video = await new NicheService(async () => f.plan).create(
    f.niche.id,
    "Complete topic",
    randomUUID(),
    f.connection,
  );
  const clip = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clip.path,
  ]);
  let generated = 0;
  const driver: FlowDriver = {
    prepare: async (input) => ({
      projectUrl: input.settings.projectUrl,
      quote: 4,
      draftSignature: "draft",
    }),
    submit: async (_job, _cap, before) => {
      await before();
      generated++;
      return { mediaId: randomUUID() };
    },
    refresh: async () => "COMPLETE",
    download: async () => clip.asset,
    upscale: async () => {
      throw Error("Unexpected upscale");
    },
  };
  const service = new StudioRunService({
    flow: new FlowJobService(driver),
    browser: {
      status: async () => ({
        projectUrl:
          "https://flow.google.com/project/11111111-1111-1111-1111-111111111111",
        message: "Connected",
      }),
    },
    plannedFrames: new NicheFrameService({
      create: async () => writeAsset(f.png, "png"),
    }),
  });
  let operation = await service.start(
    video.projectId!,
    video.versionId!,
    20,
    f.connection,
    f.niche.defaults.imageModel,
  );
  for (let i = 0; i < 30 && operation.state === "RUNNING"; i++)
    operation = await service.advance(operation.id, f.connection);
  assert.equal(operation.state, "COMPLETE", operation.error);
  assert.equal(generated, 2);
  assert(operation.asset);
  const media = await probe(assetPath(operation.asset!));
  assert.ok(Math.abs(media.duration - 10) < 0.1);
  assert.equal(media.hasAudio, false);
  assert.equal(media.width, 720);
  assert.equal(media.height, 1280);
});

test("optional storytelling works across niches without video references and changes planning cache", async (t) => {
  const f = await fixture(t);
  const story = nicheStorySchema.parse({
    sampleScripts:
      "Example: introduce a small mystery and close with one useful tip.",
    referenceGuidance: "Short sentences and practical endings",
    structure: "Question, explanation, takeaway",
    endingGuidance: "One action to try",
    sourceReference: "Product notes, edition 2",
    sourceMaterial: "The sample object is blue.",
    hookStyle: "QUESTION",
  });
  const niche = await NicheService.save({
    ...f.niche,
    referenceIds: [],
    storytelling: story,
  });
  let calls = 0;
  const service = new NicheService(async (_connection, content) => {
    calls++;
    const prompt = JSON.stringify(content);
    assert.match(prompt, /Product notes, edition 2/);
    assert.match(prompt, /sample object is blue/);
    assert.match(prompt, /Short sentences and practical endings/);
    assert.match(prompt, /Question, explanation, takeaway/);
    assert.match(prompt, /One action to try/);
    assert.match(prompt, /not fetched or verified evidence/);
    assert.match(prompt, /not words or facts to copy/);
    return f.plan;
  });
  await service.plan(niche, "A product story", [], f.connection);
  await service.plan(niche, "A product story", [], f.connection);
  assert.equal(calls, 1);
  await service.plan(
    {
      ...niche,
      storytelling: {
        ...story,
        hookStyle: "CUSTOM",
        customHook: "Start with a tiny mystery.",
      },
    },
    "A product story",
    [],
    f.connection,
  );
  assert.equal(calls, 2);
  assert.match(
    storyPrompt({ ...story, hookStyle: "CUSTOM", customHook: "My opening" }),
    /My opening/,
  );
  assert.doesNotMatch(
    storyPrompt({ ...story, customHook: "Ignored stale custom hook" }),
    /Ignored stale custom hook/,
  );
  assert.equal(nicheStorySchema.parse({}).hookStyle, "AUTO");
  assert.match(storyPrompt(story), /No reference video is supplied/);
  assert.match(storyPrompt(story, true), /Sample scripts are SECONDARY/);
  assert.equal(nicheStorySchema.parse({}).reviewBeforeGeneration, false);
  assert.equal(nicheSchema.parse(f.niche).storytelling, undefined);
  assert.equal(new Set(hookPresets.map((p) => p.id)).size, hookPresets.length);
  assert.throws(() => nicheStorySchema.parse({ hookStyle: "unknown" }));
  assert.throws(() =>
    nicheStorySchema.parse({ sampleScripts: "x".repeat(24001) }),
  );
});

test("script review persists edits into narration and frames without starting media, and rejects edits after a run", async (t) => {
  const f = await fixture(t);
  const niche = await NicheService.save({
    ...f.niche,
    referenceIds: [],
    audioMode: "FLOW_CLIPS",
    storytelling: nicheStorySchema.parse({ reviewBeforeGeneration: true }),
  });
  const plan = {
    ...f.plan,
    scenes: f.plan.scenes.map((scene) => ({
      ...scene,
      narration: "A short spoken line.",
    })),
  };
  const service = new NicheService(async () => plan);
  const requestId = randomUUID();
  const video = await service.create(
    niche.id,
    "Original story",
    requestId,
    f.connection,
  );
  const post = (payload: unknown) => {
    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    return POST(
      new Request("http://localhost:3000/api/studio/niches", {
        method: "POST",
        body: form,
      }),
    );
  };
  const response = await post({
    action: "create_video",
    nicheId: niche.id,
    topic: video.topic,
    requestId,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.video.id, video.id);
  assert.equal(result.run, undefined);
  assert.equal((await listRecords("runs")).length, 0);
  assert.equal((await listRecords("flow-jobs")).length, 0);
  const edited = structuredClone(video.plan!);
  edited.title = "Reviewed title";
  edited.hook = "An honest opening.";
  edited.scenes[0].narration = "An honest opening. A useful tip.";
  edited.scenes[0].firstFrame = "The blue object in close-up";
  const saved = await post({
    action: "save_plan",
    videoId: video.id,
    value: edited,
  });
  assert.equal(saved.status, 200);
  const project = await getRecord<Project>("projects", video.projectId!);
  const analysis = await getRecord<Analysis>("analyses", project.analysisId);
  assert.equal(project.name, "Reviewed title");
  assert.equal(
    analysis.contentPlan?.scenes[0].firstFrame,
    edited.scenes[0].firstFrame,
  );
  assert.equal(analysis.turns[0].text, edited.scenes[0].narration);
  assert.equal(analysis.turns[0].reviewed, true);
  assert.equal(analysis.revision, 2);
  assert.equal(project.versions[0].planRevision, 2);
  assert.equal((await listRecords("runs")).length, 0);
  const invalid = structuredClone(edited);
  invalid.scenes[1].narration = "word ".repeat(30);
  assert.equal(
    (await post({ action: "save_plan", videoId: video.id, value: invalid }))
      .status,
    400,
  );
  assert.equal(
    (await getRecord<Analysis>("analyses", project.analysisId)).revision,
    2,
  );
  invalid.scenes.pop();
  await assert.rejects(
    () => service.savePlan(video.id, invalid),
    /exactly 2 scenes/,
  );
  await saveRecord("runs", { id: randomUUID(), projectId: project.id });
  assert.equal(
    (await post({ action: "save_plan", videoId: video.id, value: edited }))
      .status,
    400,
  );
});

test("niche endpoints reject foreign origins and invalid templates before requesting providers", async (t) => {
  await fixture(t);
  assert.equal(
    (await GET(new Request("http://evil.test/api/studio/niches"))).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/studio/niches", {
          method: "POST",
          headers: { origin: "https://evil.test" },
          body: "{}",
        }),
      )
    ).status,
    400,
  );
  const form = new FormData();
  form.set(
    "payload",
    JSON.stringify({ action: "save", value: { name: "Incomplete" } }),
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/studio/niches", {
          method: "POST",
          body: form,
        }),
      )
    ).status,
    400,
  );
});
