import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import {
  MotionAnalysisService as Motion,
  MAX_MOTION_FRAMES,
} from "../app/lib/studio/services/MotionAnalysisService";
import {
  segmentMotion,
  segmentMotionText,
  trimShotMotion,
  evidenceLabel,
} from "../app/lib/studio/motion";
import { referenceLinkCurrent } from "../app/lib/studio/references";
import { PromptGenerationService } from "../app/lib/studio/services/PromptGenerationService";
import { KeyframeService } from "../app/lib/studio/services/KeyframeService";
import { VideoAssemblyService } from "../app/lib/studio/services/VideoAssemblyService";
import { ScenePlannerService } from "../app/lib/studio/services/ScenePlannerService";
import { VideoAnalysisService } from "../app/lib/studio/services/VideoAnalysisService";
import {
  analysisEditSchema,
  validateTimeline,
} from "../app/lib/studio/validation";
import {
  newVersion,
  defaultVoice,
  type Character,
  type MotionBeat,
  type Shot,
  type Segment,
  type Analysis,
} from "../app/lib/studio/types";
import {
  assetPath,
  newAsset,
  writeAsset,
} from "../app/lib/studio/server/store";
import { probe, run } from "../app/lib/studio/server/ffmpeg";
import { defaultConnection } from "../app/lib/studio/connection";

const root = path.resolve(`.studio-test-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = root;
const shot: Shot = {
  id: "shot",
  start: 0,
  end: 10.8333,
  description: "A tabletop action",
  camera: "Static",
  lighting: "Even",
  motion: "",
};
const beat = (
  start: number,
  end: number,
  action = "Object tips",
): MotionBeat => ({
  id: randomUUID(),
  start,
  end,
  action,
  phase: "ACTION",
  importance: "KEY",
  confidence: "MEDIUM",
  evidenceTimes: [start, end],
  anchorTime: end,
  reviewed: false,
});
let source: Analysis;
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
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    media.path,
  ]);
  source = await VideoAnalysisService.inspect(media.asset, "test.mp4");
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("audio tails retain their duration and use real final frames for analysis and keyframes", async () => {
  const media = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1.408",
    "-vf",
    "select='eq(n,0)+eq(n,7)+eq(n,23)'",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    media.path,
  ]);
  const analysis = await VideoAnalysisService.inspect(media.asset, "dance.mp4");
  assert.ok(analysis.media.duration > 1.4);
  assert.equal(analysis.media.hasAudio, true);
  const time = analysis.media.duration - 1 / analysis.media.fps;
  assert.ok(time > 0.8, "sample falls after the final actual VFR frame");
  const lastObserved = await Motion.frame(
    analysis.sourceHash,
    media.asset,
    23 / 30 - 0.000001,
  );
  const tail = await Motion.frame(analysis.sourceHash, media.asset, time);
  assert.deepEqual(
    await readFile(assetPath(tail)),
    await readFile(assetPath(lastObserved)),
  );
  assert.equal(
    await Motion.frame(analysis.sourceHash, media.asset, time),
    tail,
  );
  const original = await KeyframeService.originalFrame(analysis, time);
  assert.ok((await readFile(assetPath(original))).length > 0);
  await assert.rejects(
    Motion.frame(analysis.sourceHash, media.asset, analysis.media.duration + 1),
    /No source frame exists/,
  );
  await assert.rejects(
    Motion.frame(analysis.sourceHash, media.asset, -1),
    /non-negative/,
  );

  // An imported generated clip can carry a different soundtrack. ORIGINAL must
  // take its audio from the uploaded source, keeping the entire song duration.
  const silentClip = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=160x90:r=30:d=2",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    silentClip.path,
  ]);
  const version = newVersion("Dance");
  version.aspect = "9:16";
  version.segments = [
    {
      id: "dance",
      shotId: analysis.shots[0].id,
      start: 0,
      end: analysis.media.duration,
      duration: 4,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 0,
      warnings: [],
    },
  ];
  version.planRevision = analysis.revision;
  version.clips.dance = {
    asset: silentClip.asset,
    media: await probe(silentClip.path),
    trim: 0,
  };
  const result = await VideoAssemblyService.assemble(analysis, version, []);
  const exported = await probe(assetPath(result.asset));
  assert.equal(exported.hasAudio, true);
  assert.equal(exported.height, 1280);
  assert.ok(Math.abs(exported.duration - analysis.media.duration) < 0.1);
});

test("dense motion windows cover long shots without silently reducing temporal resolution", () => {
  for (const interval of [
    shot,
    { ...shot, start: 1.37, end: 601.37 },
    { ...shot, end: 0.02 },
  ]) {
    const windows = Motion.windows(interval);
    assert.equal(windows[0].start, interval.start);
    assert.equal(windows.at(-1)!.end, interval.end);
    for (const [index, window] of windows.entries()) {
      if (index) assert.equal(windows[index - 1].end, window.start);
      const times = Motion.frameTimes(window, 30);
      assert.ok(times.length <= 18);
      assert.ok(Motion.maxGap(times) <= 0.500001);
      assert.ok(
        times.every((t) => t >= window.start - 0.000001 && t < window.end),
      );
    }
  }
  assert.equal(Motion.frameTimes(shot, 30).length, 23); // The former 7-frame example now has complete half-second coverage.
  assert.ok(
    Motion.frameTimes(shot, 1).every(
      (t, i, all) => !i || t - all[i - 1] >= 0.8,
    ),
  );
});

test("measured frame-change peaks target quarter-second sampling without dropping base observations", async () => {
  const scores = await Motion.changes(source.sourceHash, source.sourceAsset);
  assert.ok(
    scores.some((s) => s.time >= 1.75 && s.time <= 2.25 && s.score > 2),
  );
  const ranges = Motion.rapidRanges({ start: 0, end: 4 }, scores);
  assert.ok(ranges.some((r) => r.start < 2 && r.end > 2));
  assert.ok(
    !Motion.rapidRanges({ start: 0, end: 2 }, scores).some((r) => r.end > 2),
  );
  const times = Motion.frameTimes({ start: 0, end: 4 }, 30);
  const dense = Motion.addFineSamples(times, ranges, 30);
  assert.ok(times.every((t) => dense.includes(t)));
  assert.ok(dense.length > times.length && dense.length <= MAX_MOTION_FRAMES);
  assert.ok(dense.some((t) => t > 1.5 && t < 2 && !times.includes(t)));
});

test("model timings are widened to observed brackets and invalid evidence is rejected", () => {
  const raw = [
    {
      start: 4.2,
      end: 4.8,
      anchorTime: 4.6,
      action: "Reaction begins",
      phase: "REACTION" as const,
      importance: "KEY" as const,
      confidence: "MEDIUM" as const,
    },
  ];
  const result = Motion.beats(raw, [4, 4.5, 5], { start: 4, end: 5.1 });
  assert.equal(result[0].start, 4);
  assert.equal(result[0].end, 5);
  assert.deepEqual(result[0].evidenceTimes, [4, 4.5, 5]);
  assert.equal(result[0].anchorTime, 4.5);
  assert.equal(result[0].reviewed, false);
  assert.throws(
    () =>
      Motion.beats([{ ...raw[0], end: 6 }], [4, 4.5, 5], {
        start: 4,
        end: 5.1,
      }),
    /outside/,
  );
});

test("activity duration stays separate from onset uncertainty and model confidence never becomes verification", () => {
  const raw = {
    start: 0.5,
    end: 2.75,
    anchorTime: 2.75,
    action: "Stirring continuously",
    phase: "ACTION" as const,
    importance: "KEY" as const,
    confidence: "HIGH" as const,
    timingKind: "ACTIVITY" as const,
    stateBefore: "Spoon still",
    stateAfter: "Spoon moving",
  };
  const times = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 2.75];
  const unknown = Motion.beats([raw], times, { start: 0, end: 3 })[0];
  assert.equal(unknown.end, 2.75);
  assert.equal(unknown.onset, undefined);
  assert.deepEqual(
    Motion.refinementRanges([unknown], { start: 0, end: 3 }),
    [],
  );
  assert.notEqual(unknown.confidence, "HIGH");
  assert.match(evidenceLabel(unknown), /inferred movement/);
  assert.match(evidenceLabel({ ...unknown, reviewed: true }), /human-verified/);
  assert.match(
    evidenceLabel({ ...unknown, timingKind: "OBSERVATION" }),
    /observed pose/,
  );
  const known = Motion.beats(
    [{ ...raw, onset: { start: 0.2, end: 0.5 } }],
    times,
    { start: 0, end: 3 },
  )[0];
  assert.equal(known.start, 0.5);
  assert.equal(known.end, 2.75);
  assert.deepEqual(known.onset, { start: 0, end: 0.5 });
  assert.ok(known.evidenceTimes.includes(0));
  assert.equal(
    Motion.refinementRanges([known], { start: 0, end: 3 }).length,
    1,
  );
  const ongoing = Motion.beats(
    [{ ...raw, continuing: true, onset: { start: 0, end: 0.5 } }],
    times,
    { start: 0, end: 3 },
  )[0];
  assert.equal(ongoing.onset, undefined);
  assert.match(
    segmentMotionText(
      { ...shot, motionBeats: [ongoing] },
      { start: 1, end: 2 },
    ),
    /already ongoing, do not restart/,
  );
});

test("continuation windows cannot restart setup and recovery requires an observed settled state", () => {
  const raw = {
    start: 8,
    end: 8.5,
    anchorTime: 8.5,
    action: "Hands remain extended",
    phase: "SETUP" as const,
    importance: "NORMAL" as const,
    confidence: "HIGH" as const,
    timingKind: "OBSERVATION" as const,
  };
  const continued = Motion.beats(
    [raw],
    [8, 8.25, 8.5, 9],
    { start: 8, end: 9.1 },
    { shotStart: 0, previous: beat(7, 7.5) },
  )[0];
  assert.equal(continued.phase, "ACTION");
  assert.equal(continued.continuing, true);
  const unverified = Motion.beats(
    [{ ...raw, phase: "RECOVERY", settled: false }],
    [8, 8.5, 9],
    { start: 8, end: 9.1 },
  )[0];
  assert.equal(unverified.phase, "ACTION");
  assert.ok(unverified.timingNotes?.length);
  const recovered = Motion.beats(
    [
      {
        ...raw,
        phase: "RECOVERY",
        settled: true,
        stateAfter: "Prop stable and hands at rest",
      },
    ],
    [8, 8.5, 9],
    { start: 8, end: 9.1 },
  )[0];
  assert.equal(recovered.phase, "RECOVERY");
});

test("continuous segments share boundary images and replacement identity while cuts/overlap remain independent", async () => {
  const first: Segment = {
    id: "first",
    shotId: source.shots[0].id,
    start: 0,
    end: 1,
    duration: 4,
    overlap: 0,
    strategy: "FIRST_LAST",
    credits: 0,
    warnings: [],
  };
  const second: Segment = { ...first, id: "second", start: 1, end: 2 };
  const cut: Segment = {
    ...first,
    id: "cut",
    shotId: source.shots[1].id,
    start: 2,
    end: 4,
  };
  const version = newVersion("version");
  version.segments = [first, second, cut];
  const character: Character = {
    id: "replacement",
    name: "User's character",
    description: "An illustrated performer",
    visualStyle: "2D",
    references: [],
    voice: defaultVoice(),
    updatedAt: "now",
  };
  const analysis = {
    ...source,
    speakers: [{ id: "actor", name: "Actor", description: "At center" }],
  };
  version.mappings.actor = character.id;
  let calls = 0;
  const service = new KeyframeService({
    replace: async (input) => {
      calls++;
      return writeAsset(await readFile(assetPath(input.source)), "png");
    },
  });
  const connection = { ...defaultConnection(), imagesEnabled: true };
  version.frames[first.id] = await KeyframeService.extract(analysis, first);
  version.frames[second.id] = await KeyframeService.extract(analysis, second);
  assert.equal(version.frames[first.id].last, version.frames[second.id].first);
  version.frames[first.id] = await service.generate(
    analysis,
    version,
    first,
    version.frames[first.id],
    [character],
    "image-model",
    connection,
  );
  const before = calls;
  version.frames[second.id] = await service.generate(
    analysis,
    version,
    second,
    version.frames[second.id],
    [character],
    "image-model",
    connection,
  );
  assert.equal(calls - before, 1);
  assert.equal(
    version.frames[second.id].generated!.first,
    version.frames[first.id].generated!.last,
  );
  assert.equal(
    version.frames[second.id].generated!.inheritedFrom?.segmentId,
    first.id,
  );
  version.frames[first.id].generated!.last = await writeAsset(
    await readFile(assetPath(version.frames[first.id].last)),
    "png",
  );
  assert.equal(referenceLinkCurrent(version, second), false);
  version.frames[second.id] = await service.generate(
    analysis,
    version,
    second,
    version.frames[second.id],
    [character],
    "image-model",
    connection,
  );
  assert.equal(referenceLinkCurrent(version, second), true);
  version.frames[cut.id] = await KeyframeService.extract(analysis, cut);
  assert.notEqual(version.frames[second.id].last, version.frames[cut.id].first);
  const beforeCut = calls;
  const cutFrames = await service.generate(
    analysis,
    version,
    cut,
    version.frames[cut.id],
    [character],
    "image-model",
    connection,
  );
  assert.equal(calls - beforeCut, 2);
  assert.equal(cutFrames.generated!.inheritedFrom, undefined);
  const overlap = { ...second, id: "overlap", start: 0.75, overlap: 0.25 };
  version.segments.push(overlap);
  const beforeOverlap = calls;
  const overlapFrames = await service.generate(
    analysis,
    version,
    overlap,
    await KeyframeService.extract(analysis, overlap),
    [character],
    "image-model",
    connection,
  );
  assert.equal(calls - beforeOverlap, 2);
  assert.equal(overlapFrames.generated!.inheritedFrom, undefined);
  assert.match(
    PromptGenerationService.generate(analysis, version, overlap, [character]),
    /controlled overlap/,
  );
  const prompt = PromptGenerationService.generate(analysis, version, second, [
    character,
  ]);
  assert.match(prompt, /Continue the same camera shot/);
  assert.match(prompt, /Do not reset to setup/);
});

test("Flow prompts clip and rebase motion, preserve crossing brackets, and support old timestamps", () => {
  const timed: Shot = {
    ...shot,
    motionBeats: [
      beat(1, 1.5, "Set up the prop"),
      beat(7.75, 8.25, "Object tips"),
      beat(9, 9.25, "Actor reacts"),
    ],
  };
  const segment: Segment = {
    id: "segment",
    shotId: shot.id,
    start: 8,
    end: 10.8333,
    duration: 4,
    overlap: 0,
    strategy: "FIRST_LAST",
    credits: 0,
    warnings: [],
  };
  const plan = segmentMotion(timed, segment);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].start, 0);
  assert.equal(plan[0].end, 0.25);
  assert.equal(plan[0].crossesBoundary, true);
  assert.equal(plan[1].start, 1);
  assert.ok(!segmentMotionText(timed, segment).includes("Set up the prop"));
  const legacy = segmentMotionText(
    { ...shot, motion: "0.000s: Set up; 5.400s: Recoil; 9.000s: Reach" },
    segment,
  );
  assert.match(legacy, /1.000s.*observed pose; onset unknown.*Reach/);
  assert.ok(!legacy.includes("Recoil"));
  const analysis: Analysis = { ...source, shots: [timed] };
  const prompt = PromptGenerationService.generate(
    analysis,
    newVersion("version"),
    segment,
    [],
  );
  assert.match(prompt, /seconds from THIS segment/);
  assert.match(prompt, /0.000–0.250s/);
  assert.ok(!prompt.includes("subtract 8"));
  assert.match(prompt, /No spoken dialogue/);
});

test("planning avoids splitting a key action when its boundary fits the same generation count", () => {
  const analysis = {
    ...source,
    media: { ...source.media, duration: shot.end },
    shots: [{ ...shot, motionBeats: [beat(7.75, 8.25)] }],
  };
  const segments = ScenePlannerService.plan(analysis, newVersion("version"));
  assert.equal(segments.length, 2);
  assert.equal(segments[0].end, 7.75);
});

test("timing edits validate shot bounds and key-pose images are included in Flow packages", async () => {
  const timed: Shot = {
    ...source.shots[0],
    motionBeats: [beat(0.5, 1)],
    motion: "",
  };
  const analysis = { ...source, shots: [timed, source.shots[1]] };
  timed.motionBeats![0].evidence = await Motion.evidence(
    source.sourceHash,
    source.sourceAsset,
    timed.motionBeats![0],
  );
  assert.throws(
    () =>
      validateTimeline(
        analysisEditSchema.parse({
          ...analysis,
          shots: [{ ...timed, motionBeats: [beat(0, 3)] }, source.shots[1]],
        }),
        source.media.duration,
      ),
    /inside their shot/,
  );
  const trimmed = trimShotMotion(timed, 0.75, 2);
  assert.equal(trimmed.motionBeats![0].start, 0.75);
  const version = newVersion("version");
  version.segments = ScenePlannerService.plan(analysis, version);
  version.planRevision = analysis.revision;
  const segment = version.segments[0];
  const frames = await KeyframeService.extract(analysis, segment);
  assert.equal(frames.moments?.length, 1);
  assert.equal(frames.moments![0].time, 1);
  version.frames[segment.id] = frames;
  const project = {
    id: "project",
    name: "Project",
    analysisId: analysis.id,
    versions: [version],
    updatedAt: "now",
  };
  const archive = await VideoAssemblyService.downloadPackage(
    project,
    analysis,
    version,
    [],
    { [segment.id]: "prompt" },
  );
  const files = unzipSync(await readFile(assetPath(archive)));
  assert.ok(files[frames.moments![0].asset]);
  assert.ok(files[timed.motionBeats![0].evidence!.before.asset]);
  assert.ok(files[timed.motionBeats![0].evidence!.after.asset]);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.segments[0].motionPlan[0].start, 0.5);
});
