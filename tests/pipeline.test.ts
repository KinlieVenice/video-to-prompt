import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { POST, GET } from "../app/api/studio/route";
import { GET as getAsset } from "../app/api/assets/[asset]/route";
import { run, probe } from "../app/lib/studio/server/ffmpeg";
import {
  assetPath,
  newAsset,
  getRecord,
  saveRecord,
  state,
} from "../app/lib/studio/server/store";
import {
  newVersion,
  defaultVoice,
  type Analysis,
  type Character,
  type Project,
} from "../app/lib/studio/types";
import { ScenePlannerService } from "../app/lib/studio/services/ScenePlannerService";
import { SpeakerDiarizationService } from "../app/lib/studio/services/SpeakerDiarizationService";
import { VoiceService } from "../app/lib/studio/services/VoiceService";
import { KeyframeService } from "../app/lib/studio/services/KeyframeService";
import { PromptGenerationService } from "../app/lib/studio/services/PromptGenerationService";
import {
  VideoAssemblyService,
  subtitles,
} from "../app/lib/studio/services/VideoAssemblyService";

const testRoot = path.resolve(`.studio-test-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = testRoot;
let sourceAsset: string, project: Project, analysis: Analysis;
const character: Character = {
  id: randomUUID(),
  name: "Test performer",
  description: "A small illustrated actor",
  visualStyle: "2D",
  references: [],
  voice: defaultVoice(),
  updatedAt: new Date().toISOString(),
};
async function action(
  action: string,
  payload: Record<string, unknown> = {},
  file?: File,
) {
  const form = new FormData();
  form.set("action", action);
  form.set(
    "payload",
    JSON.stringify({
      projectId: project?.id,
      versionId: project?.versions[0].id,
      ...payload,
    }),
  );
  if (file) form.set("file", file);
  const response = await POST(
    new Request("http://localhost:3000/api/studio", {
      method: "POST",
      body: form,
    }),
  );
  const body = await response.json();
  return { response, body };
}
before(async () => {
  const source = await newAsset("mp4");
  sourceAsset = source.asset;
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    "4",
    source.path,
  ]);
});
after(async () => {
  const cwd = path.resolve(process.cwd());
  assert.ok(testRoot.startsWith(cwd + path.sep));
  assert.ok(path.basename(testRoot).startsWith(".studio-test-"));
  await rm(testRoot, { recursive: true, force: true });
});

test("Phase 1: upload, measured hard cut, editable transcript and independent character mapping", async () => {
  const upload = new File(
    [await readFile(assetPath(sourceAsset))],
    "reference.MP4",
    { type: "video/mp4" },
  );
  const created = await action("create_project", {}, upload);
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  project = created.body.projects[0];
  analysis = created.body.analyses[0];
  assert.equal(analysis.shots.length, 2);
  assert.ok(Math.abs(analysis.shots[0].end - 2) < 0.04);
  assert.equal(project.versions[0].audioMode, "ORIGINAL");
  const edited = {
    shots: analysis.shots,
    speakers: [{ id: "actor1", name: "Actor 1", description: "left side" }],
    turns: [
      {
        id: "line1",
        speakerId: "actor1",
        start: 0.5,
        end: 1.5,
        text: "Putang ina, are you ready na?",
        emotion: "shouting",
        gesture: "waves",
        reviewed: true,
      },
    ],
  };
  const corrected = await action("save_analysis", { value: edited });
  assert.equal(corrected.response.status, 200);
  analysis = corrected.body.analyses[0];
  const revision = analysis.revision;
  const saved = await action("save_character", { value: character });
  assert.equal(saved.response.status, 200);
  const v = { ...project.versions[0], mappings: { actor1: character.id } };
  const mapped = await action("save_version", { value: v });
  assert.equal(mapped.response.status, 200, JSON.stringify(mapped.body));
  project = mapped.body.projects[0];
  assert.equal(mapped.body.analyses[0].revision, revision);
  assert.equal(mapped.body.analyses[0].turns[0].text, edited.turns[0].text);
  const duplicate = await action("duplicate_version");
  assert.equal(duplicate.body.projects[0].versions.length, 2);
  assert.equal(duplicate.body.projects[0].analysisId, analysis.id);
  project = duplicate.body.projects[0];
});

test("Phase 1: invalid timelines and nonlocal requests are rejected", async () => {
  const invalid = await action("save_analysis", {
    value: {
      shots: [{ ...analysis.shots[0], end: 0.2 }],
      speakers: analysis.speakers,
      turns: analysis.turns,
    },
  });
  assert.equal(invalid.response.status, 400);
  const remote = await GET(new Request("http://evil.example/api/studio"));
  assert.equal(remote.status, 400);
  const cross = await GET(
    new Request("http://localhost:3000/api/studio", {
      headers: { Origin: "https://evil.example" },
    }),
  );
  assert.equal(cross.status, 400);
  const alias = await GET(
    new Request("http://localhost:3000/api/studio", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    }),
  );
  assert.equal(alias.status, 200);
  assert.throws(() => assetPath("../private.json"));
});

test("Phase 2: TTS preserves exact Taglish and profanity, caches audio, saves takes and rejects stale voices", async () => {
  const sample = await newAsset("wav");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=0.6",
    sample.path,
  ]);
  const wav = (await readFile(sample.path)).toString("base64");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.input[0].content[0].text, analysis.turns[0].text);
    assert.match(body.input[0].content[0].annotations[0].style, /shouting/);
    return Response.json({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [{ type: "audio", mime_type: "audio/wav", data: wav }],
        },
      ],
    });
  }) as typeof fetch;
  try {
    const first = await action("generate_line", {
      turnId: "line1",
      apiKey: "fake-test-key",
    });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    project = first.body.projects[0];
    const again = await action("generate_line", {
      turnId: "line1",
      apiKey: "fake-test-key",
    });
    assert.equal(again.response.status, 200);
    assert.equal(calls, 1);
    assert.equal(again.body.projects[0].versions[0].audioTakes.line1.length, 1);
    const regenerated = await action("generate_line", {
      turnId: "line1",
      apiKey: "fake-test-key",
      regenerate: true,
    });
    assert.equal(regenerated.response.status, 200);
    assert.equal(calls, 2);
    project = regenerated.body.projects[0];
    assert.equal(project.versions[0].audioTakes.line1.length, 2);
    assert.notEqual(
      VoiceService.key(analysis.turns[0], character.voice),
      VoiceService.key(analysis.turns[0], {
        ...character.voice,
        voiceId: "Puck",
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Phase 3: planner respects every hard cut and covers source once, even with controlled overlap", () => {
  for (const target of ["VEO_LITE", "OMNI_FLASH"] as const)
    for (const overlap of [0, 0.5, 1])
      for (const length of [0.1, 3.9, 4, 8, 8.1, 16.3, 33]) {
        const synthetic = {
          ...analysis,
          media: { ...analysis.media, duration: length + 3 },
          shots: [
            { ...analysis.shots[0], start: 0, end: length },
            { ...analysis.shots[1], start: length, end: length + 3 },
          ],
        };
        const v = {
          ...newVersion("test"),
          target,
          maxDuration: target === "VEO_LITE" ? 8 : 10,
          overlap,
        };
        const segments = ScenePlannerService.plan(synthetic, v);
        let cursor = 0;
        for (const s of segments) {
          const shot = synthetic.shots.find((x) => x.id === s.shotId)!;
          assert.ok(s.start >= shot.start - 0.001);
          assert.ok(s.end <= shot.end + 0.001);
          assert.ok(s.end > s.start);
          assert.ok(s.end - s.start <= s.duration + 0.001);
          assert.ok(Math.abs(s.start + s.overlap - cursor) < 0.001);
          cursor = s.end;
        }
        assert.ok(Math.abs(cursor - synthetic.media.duration) < 0.001);
      }
  assert.throws(
    () =>
      ScenePlannerService.plan(analysis, {
        ...newVersion("bad"),
        maxDuration: 10,
      }),
    /unsupported/,
  );
  const ingredients = ScenePlannerService.plan(analysis, {
    ...newVersion("ingredients"),
    strategy: "INGREDIENTS",
  });
  assert.ok(ingredients.every((s) => s.duration === 8));
  const extendedSource = {
    ...analysis,
    media: { ...analysis.media, duration: 20 },
    shots: [{ ...analysis.shots[0], start: 0, end: 20 }],
  };
  const extension = ScenePlannerService.plan(extendedSource, {
    ...newVersion("extension"),
    strategy: "EXTEND",
  });
  assert.equal(extension[0].strategy, "FRAMES");
  assert.equal(extension[0].duration, 8);
  assert.equal(extension[1].strategy, "EXTEND");
  assert.equal(extension[1].continuationOf, extension[0].id);
});

test("Phase 3: original frames, adapter replacement, cached images and character-agnostic prompts", async () => {
  const planned = await action("plan");
  assert.equal(planned.response.status, 200);
  project = planned.body.projects[0];
  const v = project.versions[0],
    segment = v.segments[0];
  const frames = await KeyframeService.extract(analysis, segment);
  let count = 0;
  const service = new KeyframeService({
    replace: async () => {
      count++;
      return frames.first;
    },
  });
  const generated = await service.generate(
    analysis,
    v,
    segment,
    frames,
    [character],
    "gemini-nano-banana-2.1",
    "fake",
  );
  const cached = await service.generate(
    analysis,
    v,
    segment,
    frames,
    [character],
    "gemini-nano-banana-2.1",
    "fake",
  );
  assert.equal(count, 2);
  assert.deepEqual(cached, generated);
  const prompt = PromptGenerationService.generate(analysis, v, segment, [
    character,
  ]);
  assert.ok(prompt.includes(character.name));
  assert.ok(prompt.includes(analysis.turns[0].text));
  assert.match(prompt, /new shot/);
  assert.match(prompt, /verbatim/);
  const silent = SpeakerDiarizationService.activity(
    "silence_start: 0\nsilence_end: 1\nsilence_start: 3",
    4,
  );
  assert.deepEqual(silent, [{ start: 1, end: 3 }]);
  v.frames[segment.id] = generated;
  const prompts = Object.fromEntries(
    v.segments.map((s) => [
      s.id,
      PromptGenerationService.generate(analysis, v, s, [character]),
    ]),
  );
  const archive = await VideoAssemblyService.downloadPackage(
    project,
    analysis,
    v,
    [character],
    prompts,
  );
  const files = unzipSync(await readFile(assetPath(archive)));
  assert.ok(files[frames.first]);
  assert.ok(files[frames.last]);
  assert.ok(strFromU8(files["segment-01-prompt.txt"]).includes(character.name));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.segments.length, 2);
  assert.equal(manifest.audioMode, "ORIGINAL");
});

test("Phase 4: FFmpeg imports and assembles all four audio modes, portrait, captions and disclosure", async () => {
  project = await getRecord<Project>("projects", project.id);
  const version = project.versions[0];
  for (const segment of version.segments)
    version.clips[segment.id] = {
      asset: sourceAsset,
      media: await probe(assetPath(sourceAsset)),
      trim: segment.start,
    };
  const original = await VoiceService.extractOriginal(sourceAsset);
  version.uploadedAudio = original;
  for (const mode of [
    "ORIGINAL",
    "CHARACTER_TTS",
    "UPLOADED",
    "SILENT",
  ] as const) {
    const v = {
      ...version,
      audioMode: mode,
      aspect: mode === "SILENT" ? ("9:16" as const) : ("16:9" as const),
      subtitles: true,
      disclosure: mode === "SILENT",
    };
    const output = await VideoAssemblyService.assemble(analysis, v, [
      character,
    ]);
    const media = await probe(assetPath(output.asset));
    assert.ok(Math.abs(media.duration - analysis.media.duration) < 0.1);
    assert.equal(media.hasAudio, mode !== "SILENT");
    assert.equal(media.width, mode === "SILENT" ? 720 : 1280);
  }
  assert.ok(subtitles(analysis).includes(analysis.turns[0].text));
  assert.match(
    subtitles(analysis, { ...version, audioOffset: 0.2 }),
    /00:00:00,700 --> 00:00:01,700/,
  );
  const slowerAnalysis = {
    ...analysis,
    turns: analysis.turns.map((t) => ({ ...t, end: 3 })),
  };
  const slowerCharacter = {
    ...character,
    voice: { ...character.voice, speed: 0.5 },
  };
  const slow = await VideoAssemblyService.assemble(
    slowerAnalysis,
    {
      ...version,
      audioMode: "CHARACTER_TTS",
      turnTiming: { line1: { offset: 0, speed: 0.5 } },
    },
    [slowerCharacter],
  );
  assert.equal((await probe(assetPath(slow.asset))).hasAudio, true);
  const overlong = {
    ...version,
    audioMode: "CHARACTER_TTS" as const,
    turnTiming: { line1: { offset: 1, speed: 1 } },
  };
  await assert.rejects(
    () => VideoAssemblyService.assemble(analysis, overlong, [character]),
    /exceeds/,
  );
  const missing = { ...version, clips: {} };
  await assert.rejects(
    () => VideoAssemblyService.assemble(analysis, missing, [character]),
    /Import/,
  );
  const changed = {
    ...character,
    voice: { ...character.voice, voiceId: "Puck" },
  };
  await assert.rejects(
    () =>
      VideoAssemblyService.assemble(
        analysis,
        { ...version, audioMode: "CHARACTER_TTS" },
        [changed],
      ),
    /saved voice has changed/,
  );
});

test("Phase 2: designed voices use the official persistent voice request and save its preview", async () => {
  const wav = await readFile(
    assetPath(await VoiceService.extractOriginal(sourceAsset)),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, options) => {
    assert.ok(String(url).endsWith("/v1beta/voices"));
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, true);
    assert.equal(body.voice.type, "prompted");
    assert.equal(
      body.voice.prompted.input,
      "A warm, expressive Filipino performer.",
    );
    return Response.json({
      id: "voice_test",
      sample_audio: { mime_type: "audio/wav", data: wav.toString("base64") },
    });
  }) as typeof fetch;
  try {
    const designed = await VoiceService.design(
      {
        ...character,
        voice: {
          ...character.voice,
          designPrompt: "A warm, expressive Filipino performer.",
        },
      },
      "fake-test-key",
    );
    assert.equal(designed.voice.kind, "DESIGNED");
    assert.equal(designed.voice.voiceId, "voice_test");
    assert.ok(designed.voice.previewAsset);
    assert.equal(
      (await probe(assetPath(designed.voice.previewAsset!))).hasAudio,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Phase 5: persisted state excludes API keys; assets support seeking and reject traversal", async () => {
  const snapshot = await state();
  assert.ok(!JSON.stringify(snapshot).includes("fake-test-key"));
  assert.equal(snapshot.analyses.length, 1);
  assert.equal(snapshot.characters.length, 1);
  const response = await getAsset(
    new Request("http://localhost:3000/api/assets/anything", {
      headers: { range: "bytes=0-15" },
    }),
    { params: Promise.resolve({ asset: sourceAsset }) },
  );
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 16);
  const invalid = await getAsset(
    new Request("http://localhost:3000/api/assets/anything", {
      headers: { range: "bytes=999999999-" },
    }),
    { params: Promise.resolve({ asset: sourceAsset }) },
  );
  assert.equal(invalid.status, 416);
  const traversal = await getAsset(
    new Request("http://localhost:3000/api/assets/anything"),
    { params: Promise.resolve({ asset: "../package.json" }) },
  );
  assert.equal(traversal.status, 404);
  await saveRecord("projects", project);
});

test("Phase 5: reference uploads accept JPEG and invalidate dependent visuals without reanalysis", async () => {
  const version = project.versions[0];
  await saveRecord("projects", project);
  const frames = await KeyframeService.extract(analysis, version.segments[0]);
  const jpeg = await newAsset("jpg");
  await run("ffmpeg", [
    "-y",
    "-i",
    assetPath(frames.first),
    "-frames:v",
    "1",
    jpeg.path,
  ]);
  const uploaded = await action(
    "upload_reference",
    { characterId: character.id },
    new File([await readFile(jpeg.path)], "identity.jpeg", {
      type: "image/jpeg",
    }),
  );
  assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.characters[0].references.length, 1);
  assert.ok(uploaded.body.characters[0].references[0].endsWith(".jpg"));
  assert.deepEqual(uploaded.body.projects[0].versions[0].clips, {});
  assert.equal(uploaded.body.analyses[0].revision, analysis.revision);
  const invalid = await action(
    "upload_reference",
    { characterId: character.id },
    new File(["not an image"], "bad.png", { type: "image/png" }),
  );
  assert.equal(invalid.response.status, 400);
});
