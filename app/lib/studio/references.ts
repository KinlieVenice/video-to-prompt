import type { Segment, Version } from "./types";

export function continuousPredecessor(version: Version, segment: Segment) {
  if (segment.overlap > 0) return undefined;
  return shotPredecessor(version, segment);
}
export function shotPredecessor(version: Version, segment: Segment) {
  return version.segments.find(
    (previous) =>
      previous.id !== segment.id &&
      previous.shotId === segment.shotId &&
      previous.start < segment.start &&
      Math.abs(previous.end - (segment.start + segment.overlap)) < 0.001,
  );
}

export function referenceLinkCurrent(
  version: Version,
  segment: Segment,
): boolean {
  const inherited = version.frames[segment.id]?.generated?.inheritedFrom;
  if (!inherited) return true;
  const previous = continuousPredecessor(version, segment);
  const generated = previous && version.frames[previous.id]?.generated;
  return Boolean(
    previous &&
    previous.id === inherited.segmentId &&
    generated &&
    generated.signature === inherited.signature &&
    generated.last === inherited.asset &&
    referenceLinkCurrent(version, previous),
  );
}
