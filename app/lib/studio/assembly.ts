import { reenactmentRange } from "./range";
import type { Analysis, Version } from "./types";

export function assemblyTimeline(analysis: Analysis, version: Version) {
  const range = reenactmentRange(analysis, version);
  const total = range.end - range.start;
  const edited = version.assemblyTiming === "EDITED_CLIPS";
  let cursor = 0;
  return version.segments.map((segment, i) => {
    const clip = version.clips[segment.id];
    if (!clip) throw new Error(`Import a clip for segment ${i + 1}.`);
    const trim = clip.trim + segment.overlap;
    const available = clip.media.duration - trim;
    if (!Number.isFinite(available) || available <= 0.001)
      throw new Error(`Segment ${i + 1} has no video after trim and overlap.`);
    const last = i === version.segments.length - 1;
    const start = edited
      ? cursor
      : segment.start + segment.overlap - range.start;
    const end = edited
      ? last
        ? total
        : start + available
      : segment.end - range.start;
    if (edited && !last && end > total - 1 / 30)
      throw new Error(
        `Edited clips through segment ${i + 1} already use ${end.toFixed(2)}s of the ${total.toFixed(2)}s soundtrack. Import the sped-up earlier clips or increase their trims to leave time for the final clip.`,
      );
    if (end - start < 1 / 30 - 0.000001)
      throw new Error(
        `Segment ${i + 1} has less than one export frame remaining.`,
      );
    cursor = end;
    return {
      segmentId: segment.id,
      start,
      end,
      trim,
      duration: end - start,
      used: Math.min(available, end - start),
      hold: Math.max(0, end - start - available),
    };
  });
}
