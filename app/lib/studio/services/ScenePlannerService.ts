import type { Analysis, Segment, Strategy, Target, Version } from "../types";

export const DURATIONS: Record<Target, number[]> = {
  VEO_LITE: [4, 6, 8],
  OMNI_FLASH: [4, 6, 8, 10],
};
export function supportedDurations(target: Target, strategy: Strategy) {
  return target === "VEO_LITE" && ["INGREDIENTS", "EXTEND"].includes(strategy)
    ? [8]
    : DURATIONS[target];
}
export function flowCredits(
  target: Target,
  duration: number,
  ultra: boolean,
  override?: number,
) {
  if (override !== undefined) return override;
  return target === "VEO_LITE"
    ? ultra
      ? 5
      : 10
    : ({ 4: 7, 6: 10, 8: 12, 10: 15 }[duration] ?? 15);
}
export class ScenePlannerService {
  static plan(analysis: Analysis, version: Version): Segment[] {
    const supported = supportedDurations(version.target, version.strategy);
    const allowed = supported.filter((d) => d <= version.maxDuration);
    if (!allowed.length || !supported.includes(version.maxDuration))
      throw new Error("Selected duration is unsupported by this Flow target.");
    if (version.strategy === "EXTEND" && version.target !== "VEO_LITE")
      throw new Error("Veo Lite extension requires the Veo Lite target.");
    const maximum = Math.max(...allowed),
      segments: Segment[] = [];
    for (const shot of analysis.shots) {
      let start = shot.start,
        previous: string | undefined;
      while (start < shot.end - 0.001) {
        const ideal = Math.min(shot.end, start + maximum);
        let end = ideal;
        if (ideal < shot.end - 0.001) {
          const candidates = new Set<number>([ideal]);
          // Shift toward pauses or speaker ends, without increasing the minimum generation count.
          const remainingCount = Math.ceil(
            (shot.end - ideal) / Math.max(0.01, maximum - version.overlap),
          );
          for (const turn of analysis.turns)
            if (turn.end > start + maximum - 1.5 && turn.end <= ideal)
              candidates.add(turn.end);
          for (const span of analysis.activity)
            if (span.end > start + maximum - 1.5 && span.end <= ideal)
              candidates.add(span.end);
          const score = (point: number) =>
            analysis.turns.filter(
              (t) => t.start < point - 0.02 && t.end > point + 0.02,
            ).length *
              100 +
            (ideal - point);
          end = [...candidates]
            .filter(
              (t) =>
                Math.ceil(
                  (shot.end - t) / Math.max(0.01, maximum - version.overlap),
                ) <= remainingCount,
            )
            .sort((a, b) => score(a) - score(b))[0];
        }
        const overlap = previous
          ? Math.min(version.overlap, start - shot.start)
          : 0;
        const actualStart = start - overlap;
        // An overlap consumes generation time, so shorten the usable new interval.
        end = Math.min(end, actualStart + maximum);
        const duration =
          allowed.find((d) => d >= end - actualStart - 0.001) ?? maximum;
        const id = `${shot.id}_${segments.length}`;
        const warnings: string[] = [];
        if (version.strategy === "EXTEND")
          warnings.push(
            "Flow extension requires an eligible generated 8-second Veo clip. Import its continuation, or trim any repeated source portion from a combined download. Confirm the available extension length in Flow.",
          );
        if (
          analysis.turns.some((t) => t.start < end - 0.02 && t.end > end + 0.02)
        )
          warnings.push(
            "Dialogue crosses this generation boundary; preserve continuous audio in assembly.",
          );
        if (end - actualStart < 4)
          warnings.push("Short shot: trim generated padding during assembly.");
        const strategy =
          version.strategy === "EXTEND" && !previous
            ? "FRAMES"
            : version.strategy;
        segments.push({
          id,
          shotId: shot.id,
          start: actualStart,
          end,
          duration,
          overlap,
          strategy,
          continuationOf: strategy === "EXTEND" ? previous : undefined,
          credits:
            strategy === "ANIMATION_2D"
              ? 0
              : flowCredits(
                  version.target,
                  duration,
                  version.ultra,
                  version.creditOverride,
                ),
          warnings,
        });
        previous = id;
        start = end;
      }
    }
    return segments;
  }
}
