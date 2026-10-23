import type { Interval, MotionBeat, Shot } from "./types";

export function evidenceLabel(
  beat: Pick<MotionBeat, "reviewed" | "timingKind">,
) {
  return beat.reviewed
    ? "human-verified timing"
    : beat.timingKind === "OBSERVATION"
      ? "observed pose; AI description"
      : "inferred movement; review needed";
}

export function formatMotion(beats: MotionBeat[]) {
  return beats
    .map(
      (b) =>
        `${b.start.toFixed(3)}–${b.end.toFixed(3)}s [${b.phase.toLowerCase()}, ${b.timingKind?.toLowerCase() || "legacy timing"}, ${evidenceLabel(b)}${b.continuing ? "; ongoing, do not restart" : b.onset ? `; onset between ${b.onset.start.toFixed(3)}–${b.onset.end.toFixed(3)}s` : "; onset unknown"}]: ${b.action}`,
    )
    .join("; ")
    .slice(0, 20_000);
}
export function trimShotMotion(shot: Shot, start: number, end: number): Shot {
  const beats = shot.motionBeats
    ?.filter((b) => b.end >= start && b.start < end)
    .map((b) => ({
      ...b,
      start: Math.max(start, b.start),
      end: Math.min(end, b.end),
      anchorTime: Math.max(start, Math.min(end, b.anchorTime)),
      frameAsset:
        b.anchorTime >= start && b.anchorTime < end ? b.frameAsset : undefined,
      evidenceTimes: b.evidenceTimes.filter((t) => t >= start && t < end),
      onset:
        b.onset && b.onset.start >= start && b.onset.end <= end
          ? b.onset
          : undefined,
      continuing:
        b.continuing || (b.timingKind === "ACTIVITY" && b.start < start),
      evidence:
        b.evidence &&
        b.evidence.before.time >= start &&
        b.evidence.after.time < end
          ? b.evidence
          : undefined,
      reviewed: b.reviewed && b.start >= start && b.end <= end,
    }));
  return {
    ...shot,
    start,
    end,
    motionBeats: beats,
    motionSampling: undefined,
    motionWindows: shot.motionWindows?.filter(
      (w) => w.start >= start && w.end <= end,
    ),
    ...(beats ? { motion: formatMotion(beats) } : {}),
  };
}

export function mergeShotMotion(left: Shot, right: Shot): Shot {
  const beats = new Map<string, MotionBeat>();
  for (const beat of [
    ...(left.motionBeats || []),
    ...(right.motionBeats || []),
  ]) {
    const prior = beats.get(beat.id);
    if (!prior) {
      beats.set(beat.id, beat);
    } else if (
      prior.action === beat.action &&
      prior.phase === beat.phase &&
      prior.timingKind === beat.timingKind
    ) {
      // Splitting a beat keeps its ID on both halves. Rejoin it without creating
      // duplicate IDs or pretending the partial observations were verified.
      const pose = prior.frameAsset ? prior : beat;
      beats.set(beat.id, {
        ...prior,
        end: Math.max(prior.end, beat.end),
        anchorTime: pose.anchorTime,
        frameAsset: pose.frameAsset,
        onset: prior.onset || beat.onset,
        stateAfter: beat.stateAfter,
        evidenceTimes: [
          ...new Set([...prior.evidenceTimes, ...beat.evidenceTimes]),
        ].sort((a, b) => a - b),
        evidence: undefined,
        reviewed: false,
      });
    } else {
      let suffix = beats.size;
      let id: string;
      do {
        id = `${beat.id.slice(0, 85)}_merged_${suffix++}`;
      } while (beats.has(id));
      beats.set(id, { ...beat, id });
    }
  }
  const motionBeats = [...beats.values()].sort((a, b) => a.start - b.start);
  const join = (a: string, b: string) =>
    [...new Set([a, b].filter(Boolean))].join("; ").slice(0, 20_000);
  return {
    ...left,
    end: right.end,
    description: join(left.description, right.description),
    camera: join(left.camera, right.camera),
    lighting: join(left.lighting, right.lighting),
    motionSampling: undefined,
    motionWindows: [
      ...(left.motionWindows || []),
      ...(right.motionWindows || []),
    ],
    motionBeats:
      left.motionBeats || right.motionBeats ? motionBeats : undefined,
    motion:
      left.motionBeats || right.motionBeats
        ? formatMotion(motionBeats)
        : join(left.motion, right.motion),
  };
}
export type LocalMotion = {
  start: number;
  end: number;
  action: string;
  phase: string;
  confidence: string;
  reviewed: boolean;
  observation: boolean;
  crossesBoundary: boolean;
  timingKind?: MotionBeat["timingKind"];
  onset?: Interval;
  continuing?: boolean;
};
export function segmentMotion(shot: Shot, segment: Interval): LocalMotion[] {
  const beats = shot.motionBeats;
  const source = beats
    ? beats.map((b) => ({ ...b, observation: false }))
    : [
        ...shot.motion.matchAll(
          /(?:^|[;\n])\s*(\d+(?:\.\d+)?)\s*(?:[–-]\s*(\d+(?:\.\d+)?))?s?\s*:\s*([^;\n]+)/g,
        ),
      ].map((m) => ({
        start: Number(m[1]),
        end: Number(m[2] || m[1]),
        action: m[3].trim(),
        phase: "observation",
        confidence: "LOW",
        reviewed: false,
        observation: true,
        timingKind: undefined,
        onset: undefined,
        continuing: false,
      }));
  return source
    .filter((b) =>
      b.start === b.end
        ? b.start >= segment.start && b.start < segment.end
        : b.end > segment.start && b.start < segment.end,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((b) => ({
      start: Math.max(0, b.start - segment.start),
      end: Math.min(segment.end - segment.start, b.end - segment.start),
      action: b.action,
      phase: b.phase,
      confidence: b.confidence,
      reviewed: b.reviewed,
      observation: b.observation,
      crossesBoundary: b.start < segment.start || b.end > segment.end,
      timingKind: b.timingKind,
      onset:
        b.onset && b.onset.end >= segment.start && b.onset.start < segment.end
          ? {
              start: Math.max(0, b.onset.start - segment.start),
              end: Math.min(
                segment.end - segment.start,
                b.onset.end - segment.start,
              ),
            }
          : undefined,
      continuing:
        b.continuing ||
        (b.timingKind === "ACTIVITY" && b.start < segment.start),
    }));
}
export function segmentMotionText(shot: Shot, segment: Interval) {
  const beats = segmentMotion(shot, segment);
  return (
    beats
      .map(
        (b) =>
          `${b.start.toFixed(3)}${b.end !== b.start ? `–${b.end.toFixed(3)}` : ""}s [${b.observation ? "observed pose; onset unknown" : `${b.phase.toLowerCase()}; ${b.timingKind?.toLowerCase() || "legacy timing"}; ${evidenceLabel(b)}`}${b.continuing ? "; already ongoing, do not restart" : b.onset ? `; onset uncertainty ${b.onset.start.toFixed(3)}–${b.onset.end.toFixed(3)}s` : b.observation ? "" : "; onset unknown"}${b.crossesBoundary ? "; observed range crosses segment boundary" : ""}]: ${b.action}`,
      )
      .join("\n") ||
    "No timed action observations in this segment. Maintain the reference pose and review source motion before generation."
  );
}

export function segmentOpeningState(shot: Shot, time: number) {
  const candidates = (shot.motionWindows || [])
    .filter((w) => w.frameTime <= time)
    .map((w) => ({
      time: w.frameTime,
      text: `Pose: ${w.state.pose}. Hands/limbs: ${w.state.hands}. Objects: ${w.state.objects}. Ongoing action: ${w.state.ongoingAction}.`,
    }));
  for (const beat of shot.motionBeats || []) {
    if (beat.stateAfter && (beat.evidence?.after.time ?? beat.end) <= time)
      candidates.push({
        time: beat.evidence?.after.time ?? beat.end,
        text: beat.stateAfter,
      });
    if (beat.stateBefore && (beat.evidence?.before.time ?? beat.start) <= time)
      candidates.push({
        time: beat.evidence?.before.time ?? beat.start,
        text: beat.stateBefore,
      });
  }
  return candidates
    .filter((state) => state.time <= time)
    .sort((a, b) => b.time - a.time)[0];
}
export function criticalTiming(beat: MotionBeat): Interval | undefined {
  return beat.importance !== "KEY"
    ? undefined
    : beat.onset ||
        (beat.timingKind === "ACTIVITY" || beat.timingKind === "OBSERVATION"
          ? undefined
          : { start: beat.start, end: beat.end });
}
