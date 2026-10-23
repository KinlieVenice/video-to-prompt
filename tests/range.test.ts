import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { POST } from "../app/api/studio/route";
import { reenactmentRange } from "../app/lib/studio/range";
import { mergeShotMotion, trimShotMotion } from "../app/lib/studio/motion";
import {
  analysisEditSchema,
  validateTimeline,
} from "../app/lib/studio/validation";
import {
  newVersion,
  defaultVoice,
  type Analysis,
  type Character,
  type Project,
  type Shot,
} from "../app/lib/studio/types";
import {
  assetPath,
  getRecord,
  newAsset,
  saveRecord,
} from "../app/lib/studio/server/store";
import { probe, run } from "../app/lib/studio/server/ffmpeg";
import { VideoAnalysisService } from "../app/lib/studio/services/VideoAnalysisService";
import { ScenePlannerService } from "../app/lib/studio/services/ScenePlannerService";
import {
  VideoAssemblyService,
  subtitles,
} from "../app/lib/studio/services/VideoAssemblyService";
import { VoiceService } from "../app/lib/studio/services/VoiceService";

const root = path.resolve(`.studio-test-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = root;
let analysis: Analysis;
before(async () => {
  const media = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=2",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    "4",
    media.path,
  ]);
  analysis = await VideoAnalysisService.inspect(media.asset, "dance.mp4");
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("range planning covers only the selected interval while retaining real camera cuts", () => {
  const version = newVersion("range");
  assert.deepEqual(reenactmentRange(analysis, version), { start: 0, end: 4 });
  version.sourceRange = { start: 0.75, end: 3.5 };
  const segments = ScenePlannerService.plan(analysis, version);
  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map((s) => [s.start, s.end]),
    [
      [0.75, 2],
      [2, 3.5],
    ],
  );
  assert.deepEqual(
    segments.map((s) => s.shotId),
    analysis.shots.map((s) => s.id),
  );
  for (const sourceRange of [
    { start: -1, end: 3 },
    { start: 0, end: 5 },
    { start: 3, end: 2 },
    { start: 1, end: 1.001 },
  ]) {
    assert.throws(
      () => ScenePlannerService.plan(analysis, { ...version, sourceRange }),
      /reenactment range/,
    );
  }
});

test("a 14–22s selection in a 22s source plans one eight-second generation", () => {
  const fullSource = {
    ...analysis,
    media: { ...analysis.media, duration: 22.105339 },
    shots: [{ ...analysis.shots[0], start: 0, end: 22.105339 }],
  };
  const version = {
    ...newVersion("late-range"),
    sourceRange: { start: 14, end: 22 },
  };
  const segments = ScenePlannerService.plan(fullSource, version);
  assert.deepEqual(
    segments.map((segment) => [segment.start, segment.end, segment.duration]),
    [[14, 22, 8]],
  );
});

test("range persistence changes only its version and rejects invalid selections before mutation", async () => {
  const version = newVersion(randomUUID());
  version.planRevision = analysis.revision;
  version.segments = ScenePlannerService.plan(analysis, version);
  const project: Project = {
    id: randomUUID(),
    name: "Range",
    analysisId: analysis.id,
    versions: [version, newVersion(randomUUID(), "Other")],
    updatedAt: "now",
  };
  await saveRecord("projects", project);
  const save = async (sourceRange: { start: number; end: number }) => {
    const form = new FormData();
    form.set("action", "save_version");
    form.set(
      "payload",
      JSON.stringify({
        projectId: project.id,
        versionId: version.id,
        value: { ...version, sourceRange },
      }),
    );
    return POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
  };
  assert.equal((await save({ start: 0.75, end: 3.5 })).status, 200);
  const saved = await getRecord<Project>("projects", project.id);
  assert.deepEqual(saved.versions[0].sourceRange, { start: 0.75, end: 3.5 });
  assert.equal(saved.versions[0].planRevision, undefined);
  assert.equal(saved.versions[1].sourceRange, undefined);
  assert.deepEqual(await getRecord("analyses", analysis.id), analysis);
  assert.equal((await save({ start: 0, end: 5 })).status, 400);
  assert.deepEqual(await getRecord("projects", project.id), saved);
});

test("merging a split rejoins shared motion beats without duplicate IDs", () => {
  const shot: Shot = {
    id: "original",
    start: 0,
    end: 4,
    description: "Dancer",
    camera: "Static",
    lighting: "Even",
    motion: "",
    motionBeats: [
      {
        id: "crossing",
        start: 1,
        end: 3,
        action: "Turn and raise arms",
        phase: "ACTION",
        importance: "KEY",
        confidence: "MEDIUM",
        timingKind: "ACTIVITY",
        onset: { start: 1, end: 1.5 },
        evidenceTimes: [1, 1.5, 2, 2.5, 3],
        anchorTime: 2.5,
        reviewed: true,
      },
    ],
  };
  const joined = mergeShotMotion(trimShotMotion(shot, 0, 2), {
    ...trimShotMotion(shot, 2, 4),
    id: "split",
  });
  assert.equal(joined.motionBeats!.length, 1);
  assert.equal(joined.motionBeats![0].start, 1);
  assert.equal(joined.motionBeats![0].end, 3);
  assert.equal(joined.motionBeats![0].continuing, false);
  assert.deepEqual(joined.motionBeats![0].onset, { start: 1, end: 1.5 });
  assert.doesNotThrow(() =>
    validateTimeline(
      analysisEditSchema.parse({ shots: [joined], speakers: [], turns: [] }),
      4,
    ),
  );
});

test("selected exports rebase clips, original music, all audio modes and captions to zero", async () => {
  const version = newVersion("selected");
  version.sourceRange = { start: 2.25, end: 3.5 };
  version.segments = ScenePlannerService.plan(analysis, version);
  version.planRevision = analysis.revision;
  version.subtitles = true;
  for (const segment of version.segments)
    version.clips[segment.id] = {
      asset: analysis.sourceAsset,
      media: analysis.media,
      trim: segment.start,
    };
  version.uploadedAudio = await VoiceService.extractOriginal(
    analysis.sourceAsset,
  );
  const character: Character = {
    id: "dancer",
    name: "Dancer",
    description: "Any character",
    visualStyle: "2D",
    references: [],
    voice: defaultVoice(),
    updatedAt: "now",
  };
  const turn = {
    id: "inside",
    speakerId: "actor",
    start: 2.1,
    end: 3.8,
    text: "Keep these exact words",
    emotion: "",
    gesture: "",
    reviewed: true,
  };
  const timed = {
    ...analysis,
    turns: [
      {
        ...turn,
        id: "outside",
        speakerId: "unmapped",
        start: 0.1,
        end: 0.5,
        text: "Outside selection",
      },
      turn,
    ],
  };
  const take = await newAsset("wav");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=1.6",
    take.path,
  ]);
  version.mappings.actor = character.id;
  version.audioTakes.inside = [
    {
      asset: take.asset,
      duration: 1.6,
      signature: VoiceService.key(turn, character.voice),
      createdAt: "now",
    },
  ];
  for (const audioMode of [
    "ORIGINAL",
    "UPLOADED",
    "CHARACTER_TTS",
    "SILENT",
  ] as const) {
    const current = { ...version, audioMode };
    const output = await VideoAssemblyService.assemble(timed, current, [
      character,
    ]);
    const media = await probe(assetPath(output.asset));
    assert.ok(Math.abs(media.duration - 1.25) < 0.1);
    assert.equal(media.hasAudio, audioMode !== "SILENT");
    assert.doesNotMatch(
      subtitles(timed, current, [character]),
      /Outside selection/,
    );
    assert.match(
      subtitles(timed, current, [character]),
      /00:00:00,000 --> 00:00:01,250/,
    );
    if (audioMode === "ORIGINAL") {
      const sound = await run("ffmpeg", [
        "-i",
        assetPath(output.asset),
        "-vn",
        "-af",
        "atrim=start=0.2:end=0.7,aresample=8000,astats=reset=0",
        "-f",
        "null",
        "-",
      ]);
      const rate = Number(
        sound.stderr.match(/Zero crossings rate: ([\d.]+)/)?.[1],
      );
      assert.ok(
        rate > 0.19 && rate < 0.25,
        `Expected the 880 Hz second section of the song, got crossing rate ${rate}`,
      );
    }
  }
  assert.match(
    subtitles(timed, { ...version, audioMode: "ORIGINAL", audioOffset: 0.2 }),
    /00:00:00,050 --> 00:00:01,250/,
  );
  assert.equal(subtitles({ ...timed, turns: [timed.turns[0]] }, version), "");
  // Timing edits can move an otherwise excluded turn into the selection.
  const shifted = { ...turn, id: "shifted", start: 3.6, end: 3.9 };
  await assert.rejects(
    VideoAssemblyService.assemble(
      { ...timed, turns: [...timed.turns, shifted] },
      {
        ...version,
        audioMode: "CHARACTER_TTS",
        turnTiming: { shifted: { offset: -0.2, speed: 1 } },
      },
      [character],
    ),
    /Generate current audio/,
  );
  const wrongPlan = {
    ...version,
    segments: ScenePlannerService.plan(analysis, newVersion("full")),
  };
  await assert.rejects(
    VideoAssemblyService.assemble(timed, wrongPlan, []),
    /outside the reenactment range/,
  );
});
