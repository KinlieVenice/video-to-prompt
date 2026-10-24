import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { guidedDefaults } from "../app/lib/studio/server/guidedDefaults";
import { guidedVersion } from "../app/lib/studio/guided";
import { defaultConnection } from "../app/lib/studio/connection";
import {
  defaultVoice,
  type Analysis,
  type Character,
  type Project,
} from "../app/lib/studio/types";
import { saveRecord, getRecord } from "../app/lib/studio/server/store";
import {
  FlowJobService,
  type FlowDriver,
} from "../app/lib/studio/services/FlowJobService";
import { StudioRunService } from "../app/lib/studio/services/StudioRunService";
import { GET, POST } from "../app/api/studio/runs/route";

test("guided defaults come from env with the requested preset and reject invalid combinations", () => {
  const defaults = guidedDefaults({});
  const version = guidedVersion("preset", defaults);
  assert.equal(version.target, "OMNI_FLASH");
  assert.equal(version.flowSettings?.resolution, "360p");
  assert.equal(version.maxDuration, 8);
  assert.equal(version.strategy, "FIRST_LAST");
  assert.equal(version.aspect, "9:16");
  assert.equal(version.overlap, 0);
  assert.equal(version.visualDirection?.expression, "EXPRESSIVE");
  assert.equal(version.visualDirection?.backgroundMode, "SOURCE");
  assert.equal(version.visualDirection?.completeScene, true);
  assert.equal(version.audioMode, "ORIGINAL");
  assert.equal(version.creditOverride, undefined);
  assert.equal(defaults.imageModel, "cx/gpt-image-2.5-sunburst");
  assert.equal(
    guidedDefaults({
      STUDIO_DEFAULT_MAX_DURATION: "6",
      STUDIO_DEFAULT_COMPLETE_SCENE: "false",
    }).maxDuration,
    6,
  );
  assert.equal(
    guidedDefaults({ STUDIO_DEFAULT_COMPLETE_SCENE: "false" }).completeScene,
    false,
  );
  assert.throws(() => guidedDefaults({ STUDIO_DEFAULT_COMPLETE_SCENE: "yes" }));
  assert.throws(() =>
    guidedDefaults({ STUDIO_DEFAULT_FLOW_MODEL: "VEO_LITE" }),
  );
});

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  options: { uncertain?: boolean; overlong?: boolean } = {},
) {
  const directory = path.resolve(".tmp", `run-test-${randomUUID()}`);
  process.env.STUDIO_DATA_DIR = directory;
  t.after(async () => {
    assert(directory.startsWith(path.resolve(".tmp") + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const image = `${randomUUID()}.png`,
    media = { duration: 10, width: 360, height: 640, fps: 30, hasAudio: true };
  const analysis: Analysis = {
    id: randomUUID(),
    sourceAsset: `${randomUUID()}.mp4`,
    sourceName: "source.mp4",
    sourceHash: randomUUID(),
    media,
    status: "ANALYZED",
    revision: 1,
    createdAt: new Date().toISOString(),
    warnings: [],
    shots: [
      {
        id: "shot",
        start: 0,
        end: 10,
        description: "A performer",
        camera: "Static",
        lighting: "Soft",
        motion: "Moves",
      },
    ],
    speakers: [{ id: "actor", name: "Actor", description: "In center" }],
    turns: [],
    activity: [],
  };
  const character: Character = {
    id: randomUUID(),
    name: "User performer",
    description: "A new character",
    visualStyle: "Illustrated",
    references: [image],
    voice: defaultVoice(),
    updatedAt: new Date().toISOString(),
  };
  const version = guidedVersion(randomUUID());
  if (options.overlong) {
    version.audioMode = "CHARACTER_TTS";
    analysis.turns = [
      {
        id: "line",
        speakerId: "actor",
        start: 0,
        end: 1,
        text: "Exact dialogue",
        emotion: "",
        gesture: "",
        reviewed: true,
      },
    ];
  }
  version.mappings.actor = character.id;
  version.planRevision = 1;
  version.flowSettings!.projectUrl =
    "https://flow.google.com/project/11111111-1111-1111-1111-111111111111";
  version.segments = [
    {
      id: "one",
      shotId: "shot",
      start: 0,
      end: 6,
      duration: 6,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 10,
      warnings: [],
    },
    {
      id: "two",
      shotId: "shot",
      start: 6,
      end: 10,
      duration: 4,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 7,
      warnings: [],
    },
  ];
  for (const s of version.segments)
    version.frames[s.id] = { first: image, last: image };
  const project: Project = {
    id: randomUUID(),
    name: "Run",
    analysisId: analysis.id,
    versions: [version],
    updatedAt: new Date().toISOString(),
  };
  await saveRecord("analyses", analysis);
  await saveRecord("characters", character);
  await saveRecord("projects", project);
  const counts = { generations: 0, images: 0, assembly: 0 };
  const driver: FlowDriver = {
    prepare: async () => ({
      projectUrl: version.flowSettings!.projectUrl,
      quote: 4,
      draftSignature: "draft",
    }),
    submit: async (_job, _limit, before) => {
      await before();
      counts.generations++;
      if (options.uncertain) throw Error("Network lost");
      return { mediaId: randomUUID() };
    },
    refresh: async () => "COMPLETE",
    download: async () => `${randomUUID()}.mp4`,
    upscale: async () => {
      throw Error("No upscales requested");
    },
  };
  const service = new StudioRunService({
    voice: async () => ({
      asset: `${randomUUID()}.wav`,
      duration: 3,
      signature: "voice",
      createdAt: new Date().toISOString(),
    }),
    flow: new FlowJobService(driver),
    browser: {
      status: async () => ({
        projectUrl: version.flowSettings!.projectUrl,
        message: "Connected",
      }),
    },
    keyframes: {
      generate: async (_a, _v, _s, frames) => {
        counts.images++;
        return {
          ...frames,
          generated: { first: image, last: image, signature: "images" },
        };
      },
    },
    probe: async () => ({ ...media, duration: 8 }),
    assemble: async () => {
      counts.assembly++;
      return { asset: `${randomUUID()}.mp4`, signature: "assembled" };
    },
  });
  const connection = {
    ...defaultConnection(),
    imagesEnabled: true,
    ttsEnabled: true,
  };
  return { service, connection, project, version, character, counts };
}

test("one start automatically prepares both segments, submits once each, imports and assembles a final MP4", async (t) => {
  const f = await fixture(t);
  let run = await f.service.start(f.project.id, f.version.id, 8, f.connection);
  assert.equal(
    (await f.service.start(f.project.id, f.version.id, 8, f.connection)).id,
    run.id,
  );
  for (let n = 0; n < 30 && run.state === "RUNNING"; n++)
    run = await f.service.advance(run.id, f.connection);
  assert.equal(run.state, "COMPLETE", run.error);
  assert.ok(run.asset);
  assert.deepEqual(f.counts, { generations: 2, images: 2, assembly: 1 });
  assert.equal(
    Object.values(run.reservations).reduce((a, b) => a + b, 0),
    8,
  );
  const saved = await getRecord<Project>("projects", f.project.id);
  assert.equal(Object.keys(saved.versions[0].clips).length, 2);
  assert.equal(saved.versions[0].exportAsset, run.asset);
  await f.service.advance(run.id, f.connection);
  assert.equal(f.counts.assembly, 1);
  assert.ok(!JSON.stringify(run).includes("apiKey"));
});

test("the total credit limit pauses before a second charge and an explicit increase resumes cached work", async (t) => {
  const f = await fixture(t);
  let run = await f.service.start(f.project.id, f.version.id, 4, f.connection);
  for (let n = 0; n < 30 && run.state === "RUNNING"; n++)
    run = await f.service.advance(run.id, f.connection);
  assert.equal(run.state, "PAUSED");
  assert.match(run.error!, /credit limit/);
  assert.equal(f.counts.generations, 1);
  await f.service.resume(run.id, 8);
  for (let n = 0; n < 15; n++) {
    run = await f.service.advance(run.id, f.connection);
    if (run.state !== "RUNNING") break;
  }
  assert.equal(run.state, "COMPLETE", run.error);
  assert.equal(f.counts.generations, 2);
  assert.equal(f.counts.images, 2);
});

test("uncertain submission and changed characters never trigger an automatic paid retry", async (t) => {
  const f = await fixture(t, { uncertain: true });
  let run = await f.service.start(f.project.id, f.version.id, 8, f.connection);
  for (let n = 0; n < 20 && run.state === "RUNNING"; n++)
    run = await f.service.advance(run.id, f.connection);
  assert.equal(run.state, "PAUSED");
  assert.equal(f.counts.generations, 1);
  await f.service.resume(run.id);
  run = await f.service.advance(run.id, f.connection);
  assert.equal(run.state, "PAUSED");
  assert.equal(f.counts.generations, 1);
  await saveRecord("characters", {
    ...f.character,
    description: "Changed identity",
  });
  await f.service.resume(run.id);
  run = await f.service.advance(run.id, f.connection);
  assert.match(run.error!, /changed during this run/);
  assert.equal(f.counts.generations, 1);
});

test("automatic run endpoints reject cross-site access before touching browser or providers", async () => {
  assert.equal(
    (await GET(new Request("http://evil.test/api/studio/runs"))).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/studio/runs", {
          method: "POST",
          headers: { origin: "https://evil.test" },
          body: "{}",
        }),
      )
    ).status,
    400,
  );
});

test("overlong character audio is saved for timing correction before any image or Flow charges", async (t) => {
  const f = await fixture(t, { overlong: true });
  let run = await f.service.start(f.project.id, f.version.id, 8, f.connection);
  run = await f.service.advance(run.id, f.connection);
  assert.equal(run.state, "PAUSED");
  assert.match(run.error!, /Dialogue exceeds/);
  assert.deepEqual(f.counts, { generations: 0, images: 0, assembly: 0 });
  const saved = await getRecord<Project>("projects", f.project.id);
  assert.equal(saved.versions[0].audioTakes.line[0].duration, 3);
});
