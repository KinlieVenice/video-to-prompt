import type { Analysis, Interval, Version } from "./types";

export function reenactmentRange(
  analysis: Pick<Analysis, "media">,
  version?: Pick<Version, "sourceRange">,
): Interval {
  const range = version?.sourceRange || {
    start: 0,
    end: analysis.media.duration,
  };
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end > analysis.media.duration ||
    range.end - range.start < 1 / 30 - 0.000001
  )
    throw new Error(
      "Choose a reenactment range inside the source, with the end after the start and at least one export frame (0.034 seconds).",
    );
  return { ...range };
}
