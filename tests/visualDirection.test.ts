import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { POST } from "../app/api/studio/route";
import { defaultConnection } from "../app/lib/studio/connection";
import {
  newVersion,
  defaultVoice,
  type Analysis,
  type Character,
  type Project,
  type Segment,
  type VisualDirection,
} from "../app/lib/studio/types";
import {
  visualDirection,
  visualDirectionChanged,
} from "../app/lib/studio/visualDirection";
import { versionEditSchema } from "../app/lib/studio/validation";
import {
  actorAppearanceInstructions,
  appearanceChanged,
  appearanceNotes,
} from "../app/lib/studio/appearance";
import {
  assetPath,
  getRecord,
  newAsset,
  saveRecord,
  writeAsset,
} from "../app/lib/studio/server/store";
import { probeImage, run } from "../app/lib/studio/server/ffmpeg";
import { VideoAnalysisService } from "../app/lib/studio/services/VideoAnalysisService";
import {
  KeyframeService,
  type ImageGenerationProvider,
} from "../app/lib/studio/services/KeyframeService";
import { PromptGenerationService } from "../app/lib/studio/services/PromptGenerationService";
import { ScenePlannerService } from "../app/lib/studio/services/ScenePlannerService";
import { VideoAssemblyService } from "../app/lib/studio/services/VideoAssemblyService";

const root = path.resolve(`.studio-test-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = root;
let analysis: Analysis;
let character: Character;
const direction: VisualDirection = {
  backgroundMode: "NEW",
  backgroundPrompt: "A pastel dance studio with warm daylight",
  expression: "SUBTLE",
  completeScene: true,
};
before(async () => {
  const media = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    media.path,
  ]);
  analysis = {
    ...(await VideoAnalysisService.inspect(media.asset, "performance.mp4")),
    speakers: [
      { id: "actor", name: "Original dancer", description: "At center" },
    ],
  };
  analysis.shots[0].description =
    "A dancer in a dark room holding a small prop";
  analysis.shots[0].camera = "Fixed frontal view";
  analysis.shots[0].lighting = "Cool source lighting";
  await saveRecord("analyses", analysis);
  character = {
    id: randomUUID(),
    name: "Saved performer",
    description: "The user's chosen illustrated character",
    visualStyle: "2D",
    references: [await KeyframeService.originalFrame(analysis, 0)],
    voice: defaultVoice(),
    updatedAt: "now",
  };
  await saveRecord("characters", character);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const firstSegment = (): Segment => ({
  id: "first",
  shotId: analysis.shots[0].id,
  start: 0,
  end: 1,
  duration: 4,
  overlap: 0,
  strategy: "FIRST_LAST",
  credits: 10,
  warnings: [],
});

test("legacy versions match source expressions; new versions default to subtle expression and validate new settings", () => {
  const version = newVersion("new");
  assert.equal(visualDirection(version).expression, "SUBTLE");
  assert.equal(visualDirection(version).completeScene, true);
  const legacy = { ...version, visualDirection: undefined };
  assert.deepEqual(visualDirection(legacy), {
    backgroundMode: "SOURCE",
    backgroundPrompt: "",
    expression: "MATCH_SOURCE",
    completeScene: false,
  });
  assert.equal(
    visualDirectionChanged(legacy, {
      ...legacy,
      visualDirection: visualDirection(legacy),
    }),
    false,
  );
  assert.equal(versionEditSchema.safeParse(legacy).success, true);
  assert.equal(
    versionEditSchema.safeParse({
      ...version,
      visualDirection: { ...direction, backgroundPrompt: "  " },
    }).success,
    false,
  );
  assert.equal(
    versionEditSchema.safeParse({
      ...version,
      visualDirection: { ...direction, expression: "random" },
    }).success,
    false,
  );
  const parsed = versionEditSchema.parse({
    ...version,
    visualDirection: {
      ...direction,
      backgroundPrompt: `  ${direction.backgroundPrompt}  `,
    },
  });
  assert.deepEqual(parsed.visualDirection, direction);
});

test("Flow prompts direct the chosen background and expression without changing cast, choreography or audio", () => {
  const version = newVersion("prompts");
  version.mappings.actor = character.id;
  const segment = firstSegment();
  const sourcePrompt = PromptGenerationService.generate(
    analysis,
    {
      ...version,
      visualDirection: {
        backgroundMode: "SOURCE",
        backgroundPrompt: "",
        expression: "MATCH_SOURCE",
      },
    },
    segment,
    [character],
  );
  assert.match(sourcePrompt, /BACKGROUND — MATCH SOURCE/);
  assert.match(sourcePrompt, /EXPRESSION — MATCH SOURCE/);
  assert.match(
    sourcePrompt,
    /original background, environment layout, lighting/,
  );
  assert.doesNotMatch(sourcePrompt, /NEW ENVIRONMENT/);
  const newPrompt = PromptGenerationService.generate(
    analysis,
    { ...version, visualDirection: direction },
    segment,
    [character],
  );
  assert.ok(newPrompt.includes(direction.backgroundPrompt));
  assert.ok(newPrompt.includes(character.name));
  assert.match(newPrompt, /SLIGHTLY MORE EXPRESSIVE/);
  assert.match(newPrompt, /Preserve body poses, dance choreography, footwork/);
  assert.match(newPrompt, /source rhythm/);
  assert.match(newPrompt, /No spoken dialogue is supplied/);
  assert.match(newPrompt, /final soundtrack will be applied separately/);
  assert.doesNotMatch(
    newPrompt,
    /BACKGROUND — MATCH SOURCE|Preserve composition, relevant clothing, background/,
  );
  assert.match(
    newPrompt,
    /chosen new environment overrides their background and lighting/,
  );
  const expressive = PromptGenerationService.generate(
    analysis,
    { ...version, visualDirection: { ...direction, expression: "EXPRESSIVE" } },
    segment,
    [character],
  );
  assert.match(expressive, /EXPRESSION — MORE EXPRESSIVE/);
  assert.match(newPrompt, /SCENE UNDERSTANDING & COMPLETION/);
  assert.match(newPrompt, /extend the existing object geometry/);
  assert.match(newPrompt, /Genuine dark walls, clothing, shadows/);
  assert.doesNotMatch(sourcePrompt, /SCENE UNDERSTANDING & COMPLETION/);
});

test("scene completion fits the full source into a reusable target canvas without cropping evidence", async () => {
  const source = await KeyframeService.originalFrame(analysis, 0);
  const canvas = await KeyframeService.generationCanvas(source, "9:16");
  const image = await probeImage(assetPath(canvas));
  assert.equal(image.width, 720);
  assert.equal(image.height, 1280);
  assert.equal(await KeyframeService.generationCanvas(source, "9:16"), canvas);
  assert.equal(await KeyframeService.generationCanvas(source, "16:9"), source);
  const original = await probeImage(assetPath(source));
  assert.equal(original.width, 160);
  assert.equal(original.height, 90);
  const version = newVersion("canvas");
  version.aspect = "9:16";
  version.mappings.actor = character.id;
  const frames = await KeyframeService.extract(analysis, firstSegment());
  const calls: Parameters<ImageGenerationProvider["replace"]>[0][] = [];
  const service = new KeyframeService({
    replace: async (input) => {
      calls.push(input);
      return writeAsset(await readFile(assetPath(input.source)), "png");
    },
  });
  const generated = await service.generate(
    analysis,
    version,
    firstSegment(),
    frames,
    [character],
    "canvas-model",
    defaultConnection(),
  );
  assert.equal(calls[0].source, canvas);
  assert.match(calls[0].prompt, /Compose a full 9:16 frame/);
  assert.equal(calls[1].references.at(-1)!.asset, generated.generated!.first);
  assert.match(
    calls[1].references.at(-1)!.description,
    /completed object geometry/,
  );
  assert.notEqual(
    KeyframeService.key(
      analysis,
      version,
      firstSegment(),
      [character],
      "canvas-model",
    ),
    KeyframeService.key(
      analysis,
      { ...version, aspect: "16:9" },
      firstSegment(),
      [character],
      "canvas-model",
    ),
  );
  assert.equal(
    visualDirectionChanged(version, {
      ...version,
      visualDirection: { ...version.visualDirection!, completeScene: false },
    }),
    true,
  );
});

test("frame generation caches each look, anchors new backgrounds and inherits only matching continuous references", async () => {
  const version = newVersion("images");
  version.mappings.actor = character.id;
  const first = firstSegment();
  const second = { ...first, id: "second", start: 1, end: 2 };
  version.segments = [first, second];
  version.frames.first = await KeyframeService.extract(analysis, first);
  version.frames.second = await KeyframeService.extract(analysis, second);
  const calls: Parameters<ImageGenerationProvider["replace"]>[0][] = [];
  const service = new KeyframeService({
    replace: async (input) => {
      calls.push(input);
      return writeAsset(await readFile(assetPath(input.source)), "png");
    },
  });
  const connection = { ...defaultConnection(), imagesEnabled: true };
  const generate = (segment: Segment) =>
    service.generate(
      analysis,
      version,
      segment,
      version.frames[segment.id],
      [character],
      "test-image-route",
      connection,
    );
  version.frames.first = await generate(first);
  assert.equal(calls.length, 2);
  assert.match(calls[0].prompt, /BACKGROUND — MATCH SOURCE/);
  assert.match(calls[0].prompt, /SLIGHTLY MORE EXPRESSIVE/);
  const sourceSignature = version.frames.first.generated!.signature;
  version.frames.first = await generate(first);
  assert.equal(calls.length, 2);
  version.visualDirection = {
    backgroundMode: "SOURCE",
    backgroundPrompt: "",
    expression: "MATCH_SOURCE",
  };
  version.frames.first = await generate(first);
  assert.equal(calls.length, 4);
  assert.notEqual(version.frames.first.generated!.signature, sourceSignature);
  version.visualDirection = direction;
  version.frames.first = await generate(first);
  assert.equal(calls.length, 6);
  assert.ok(calls[4].prompt.includes(direction.backgroundPrompt));
  assert.equal(
    calls[5].references.at(-1)!.asset,
    version.frames.first.generated!.first,
  );
  assert.match(calls[5].references.at(-1)!.description, /environment anchor/);
  assert.equal(calls[4].references[0].asset, character.references[0]);
  version.frames.second = await generate(second);
  assert.equal(calls.length, 7, "continuous boundary saves one image request");
  assert.equal(
    version.frames.second.generated!.first,
    version.frames.first.generated!.last,
  );
  assert.equal(
    calls[6].references.at(-1)!.asset,
    version.frames.second.generated!.first,
  );
  version.visualDirection = {
    ...direction,
    backgroundPrompt: "A moonlit rooftop stage",
  };
  version.frames.second = await generate(second);
  assert.equal(calls.length, 9);
  assert.equal(
    version.frames.second.generated!.inheritedFrom,
    undefined,
    "a previous segment with a different background cannot supply the first image",
  );
  const beforeInvalid = calls.length;
  version.visualDirection = { ...direction, backgroundPrompt: "" };
  await assert.rejects(generate(first), /Describe the new background/);
  assert.equal(calls.length, beforeInvalid);
});

test("saving a new look invalidates generated visuals only, preserves other versions and packages the settings", async () => {
  const version = newVersion(randomUUID());
  version.mappings.actor = character.id;
  version.segments = ScenePlannerService.plan(analysis, version);
  version.planRevision = analysis.revision;
  const segment = version.segments[0];
  const frames = await KeyframeService.extract(analysis, segment);
  version.frames[segment.id] = {
    ...frames,
    generated: {
      first: frames.first,
      last: frames.last,
      signature: "old-look",
    },
  };
  version.clips[segment.id] = {
    asset: analysis.sourceAsset,
    media: analysis.media,
    trim: 0,
  };
  version.exportAsset = analysis.sourceAsset;
  version.audioTakes.saved = [
    {
      asset: analysis.sourceAsset,
      duration: 1,
      signature: "saved-audio",
      createdAt: "now",
    },
  ];
  const other = {
    ...structuredClone(version),
    id: randomUUID(),
    name: "Other version",
  };
  const project: Project = {
    id: randomUUID(),
    name: "Visual settings",
    analysisId: analysis.id,
    versions: [version, other],
    updatedAt: "now",
  };
  await saveRecord("projects", project);
  const persistedBefore = await getRecord<Project>("projects", project.id);
  const action = async (action: string, value?: unknown) => {
    const form = new FormData();
    form.set("action", action);
    form.set(
      "payload",
      JSON.stringify({ projectId: project.id, versionId: version.id, value }),
    );
    return POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
  };
  const response = await action("save_version", {
    ...version,
    visualDirection: direction,
  });
  assert.equal(response.status, 200);
  let saved = await getRecord<Project>("projects", project.id);
  const updated = saved.versions[0];
  assert.deepEqual(updated.visualDirection, direction);
  assert.deepEqual(updated.clips, {});
  assert.equal(updated.frames[segment.id].generated, undefined);
  assert.equal(updated.frames[segment.id].first, frames.first);
  assert.equal(updated.exportAsset, undefined);
  assert.equal(updated.planRevision, analysis.revision);
  assert.deepEqual(updated.segments, persistedBefore.versions[0].segments);
  assert.deepEqual(updated.audioTakes, version.audioTakes);
  assert.deepEqual(saved.versions[1], persistedBefore.versions[1]);
  assert.deepEqual(await getRecord("analyses", analysis.id), analysis);
  assert.equal(
    (
      await action("save_version", {
        ...updated,
        visualDirection: { ...direction, backgroundPrompt: " " },
      })
    ).status,
    400,
  );
  assert.deepEqual(await getRecord("projects", project.id), saved);
  // Saving identical settings (including harmless whitespace) keeps visuals.
  updated.frames[segment.id].generated = version.frames[segment.id].generated;
  updated.clips = structuredClone(version.clips);
  await saveRecord("projects", saved);
  assert.equal(
    (
      await action("save_version", {
        ...updated,
        visualDirection: {
          ...direction,
          backgroundPrompt: ` ${direction.backgroundPrompt} `,
        },
      })
    ).status,
    200,
  );
  saved = await getRecord<Project>("projects", project.id);
  assert.deepEqual(saved.versions[0].clips, version.clips);
  assert.ok(saved.versions[0].frames[segment.id].generated);
  const manifest = VideoAssemblyService.package(
    saved,
    analysis,
    saved.versions[0],
    [character],
    {},
  );
  assert.deepEqual(manifest.visualDirection, direction);
  assert.equal((await action("duplicate_version")).status, 200);
  const duplicated = await getRecord<Project>("projects", project.id);
  assert.deepEqual(duplicated.versions.at(-1)!.visualDirection, direction);
});

test("appearance overrides are actor scoped even when two actors share a profile, and caches respect edits", async () => {
  const version = newVersion("appearance");
  version.mappings = { actor: character.id, second: character.id };
  const notes = "Wear glasses and have diamonds on the teeth.";
  version.appearanceNotes = { actor: notes, second: "Wear a red cap." };
  const twoActors = {
    ...analysis,
    speakers: [
      ...analysis.speakers,
      { id: "second", name: "Second dancer", description: "At screen-right" },
    ],
  };
  const originalProfile = structuredClone(character);
  const secondInstructions = actorAppearanceInstructions(
    version,
    "second",
    "Second dancer",
    character.name,
  );
  assert.match(secondInstructions, /red cap/);
  assert.doesNotMatch(secondInstructions, /diamonds|glasses/);
  const prompt = PromptGenerationService.generate(
    twoActors,
    version,
    firstSegment(),
    [character],
  );
  assert.ok(prompt.includes(notes));
  assert.match(prompt, /APPEARANCE FOR Original dancer/);
  assert.match(prompt, /APPEARANCE FOR Second dancer/);
  assert.match(prompt, /without forcing an extra smile or mouth opening/);
  assert.deepEqual(appearanceNotes({}), {});
  assert.deepEqual(
    appearanceNotes({ appearanceNotes: { blank: "  ", actor: ` ${notes} ` } }),
    { actor: notes },
  );
  assert.equal(
    appearanceChanged(version, {
      ...version,
      appearanceNotes: { second: "Wear a red cap.", actor: ` ${notes} ` },
    }),
    false,
  );
  assert.equal(
    versionEditSchema.safeParse({
      ...version,
      appearanceNotes: { actor: "x".repeat(2001) },
    }).success,
    false,
  );
  const frames = await KeyframeService.extract(analysis, firstSegment());
  const calls: Parameters<ImageGenerationProvider["replace"]>[0][] = [];
  const service = new KeyframeService({
    replace: async (input) => {
      calls.push(input);
      return writeAsset(await readFile(assetPath(input.source)), "png");
    },
  });
  const generate = () =>
    service.generate(
      twoActors,
      version,
      firstSegment(),
      frames,
      [character],
      "appearance-model",
      defaultConnection(),
    );
  const first = await generate();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].prompt.includes(notes));
  version.appearanceNotes.actor = "Remove the glasses.";
  const changed = await generate();
  assert.equal(calls.length, 4);
  assert.notEqual(first.generated!.signature, changed.generated!.signature);
  assert.match(calls[2].prompt, /Remove the glasses/);
  assert.doesNotMatch(calls[2].prompt, /diamonds/);
  version.appearanceNotes.actor = "  Remove the glasses.  ";
  await generate();
  assert.equal(
    calls.length,
    4,
    "whitespace-only changes reuse the same images",
  );
  assert.deepEqual(character, originalProfile);
});

test("appearance-only saves preserve source, profiles, voices, audio and other versions while rejecting unmapped notes", async () => {
  const version = newVersion(randomUUID());
  version.mappings.actor = character.id;
  version.segments = ScenePlannerService.plan(analysis, version);
  version.planRevision = analysis.revision;
  const segment = version.segments[0];
  const frames = await KeyframeService.extract(analysis, segment);
  version.frames[segment.id] = {
    ...frames,
    generated: {
      first: frames.first,
      last: frames.last,
      signature: "before-appearance",
    },
  };
  version.clips[segment.id] = {
    asset: analysis.sourceAsset,
    media: analysis.media,
    trim: 0,
  };
  version.exportAsset = analysis.sourceAsset;
  version.audioTakes.saved = [
    {
      asset: analysis.sourceAsset,
      duration: 1,
      signature: "audio",
      createdAt: "now",
    },
  ];
  const project: Project = {
    id: randomUUID(),
    name: "Actor appearance",
    analysisId: analysis.id,
    versions: [
      version,
      { ...structuredClone(version), id: randomUUID(), name: "Unchanged" },
    ],
    updatedAt: "now",
  };
  await saveRecord("projects", project);
  const before = await getRecord<Project>("projects", project.id);
  const action = async (action: string, value?: unknown) => {
    const form = new FormData();
    form.set("action", action);
    form.set(
      "payload",
      JSON.stringify({ projectId: project.id, versionId: version.id, value }),
    );
    return POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
  };
  const notes = "Wear glasses and have diamonds on the teeth.";
  assert.equal(
    (
      await action("save_version", {
        ...version,
        appearanceNotes: { actor: ` ${notes} ` },
      })
    ).status,
    200,
  );
  let saved = await getRecord<Project>("projects", project.id);
  const updated = saved.versions[0];
  assert.deepEqual(updated.appearanceNotes, { actor: notes });
  assert.deepEqual(updated.clips, {});
  assert.equal(updated.frames[segment.id].generated, undefined);
  assert.equal(updated.frames[segment.id].first, frames.first);
  assert.equal(updated.planRevision, analysis.revision);
  assert.deepEqual(updated.segments, before.versions[0].segments);
  assert.deepEqual(updated.audioTakes, before.versions[0].audioTakes);
  assert.deepEqual(saved.versions[1], before.versions[1]);
  assert.deepEqual(await getRecord("characters", character.id), character);
  assert.deepEqual(await getRecord("analyses", analysis.id), analysis);
  assert.equal(
    (
      await action("save_version", {
        ...updated,
        appearanceNotes: { missing: notes },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await action("save_version", {
        ...updated,
        mappings: {},
        appearanceNotes: { actor: notes },
      })
    ).status,
    400,
  );
  assert.deepEqual(await getRecord("projects", project.id), saved);
  // Older clients that omit this optional field must not erase saved notes.
  const legacyEdit = { ...updated };
  delete legacyEdit.appearanceNotes;
  assert.equal((await action("save_version", legacyEdit)).status, 200);
  saved = await getRecord<Project>("projects", project.id);
  assert.deepEqual(saved.versions[0].appearanceNotes, { actor: notes });
  const manifest = VideoAssemblyService.package(
    saved,
    analysis,
    saved.versions[0],
    [character],
    {},
  );
  assert.deepEqual(manifest.appearanceNotes, { actor: notes });
  assert.equal((await action("duplicate_version")).status, 200);
  const duplicated = await getRecord<Project>("projects", project.id);
  assert.deepEqual(duplicated.versions.at(-1)!.appearanceNotes, {
    actor: notes,
  });
  assert.equal(
    (
      await action("save_version", {
        ...saved.versions[0],
        mappings: {},
        appearanceNotes: {},
      })
    ).status,
    200,
  );
});
