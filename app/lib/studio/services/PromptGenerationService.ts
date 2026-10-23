import type { Analysis, Character, Segment, Version } from "../types";
import { STRATEGIES } from "../types";
import { segmentMotionText, segmentOpeningState } from "../motion";
import { shotPredecessor } from "../references";

export class PromptGenerationService {
  static generate(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    characters: Character[],
  ): string {
    const shot = analysis.shots.find((s) => s.id === segment.shotId)!;
    const turns = analysis.turns.filter(
      (t) => t.end > segment.start && t.start < segment.end,
    );
    const openingState = segmentOpeningState(shot, segment.start);
    const previous = shotPredecessor(version, segment);
    const cast = analysis.speakers.map((s) => {
      const character = characters.find((c) => c.id === version.mappings[s.id]);
      return character
        ? `${s.name} (${s.description}) becomes ${character.name}: ${character.description}. Visual style: ${character.visualStyle}. Keep source clothing where relevant; use the attached character reference images for identity.`
        : `${s.name}: ${s.description}. No replacement assigned.`;
    });
    const dialogue = turns.map((t) => {
      const speaker =
        analysis.speakers.find((s) => s.id === t.speakerId)?.name ||
        t.speakerId;
      return `${Math.max(0, t.start - segment.start).toFixed(2)}–${Math.min(segment.end - segment.start, t.end - segment.start).toFixed(2)}s, ${speaker}, ${t.emotion || "natural"}: ${JSON.stringify(t.text)}. ${t.gesture}`;
    });
    return [
      `Create ${segment.duration} seconds, ${version.aspect}. Target: ${version.target === "VEO_LITE" ? "Google Flow Veo 3.1 Lite" : "Google Flow Gemini Omni Flash (720p)"}. Strategy: ${STRATEGIES[segment.strategy]}.`,
      `Reenact source interval ${segment.start.toFixed(3)}–${segment.end.toFixed(3)}s as one continuous camera shot. Preserve composition, relevant clothing, background, lighting, blocking and camera angle.`,
      ...cast,
      `Scene: ${shot.description}`,
      `Camera: ${shot.camera}. Lighting: ${shot.lighting}.`,
      `Motion plan (seconds from THIS segment's start; execute in order):\n${segmentMotionText(shot, segment)}`,
      "Activity ranges describe sustained movement, not action onset. Separate onset brackets are estimates supported by snapshots. Preserve cause before reaction; do not invent missing transitions or speed up the main action to fill padding.",
      openingState
        ? `Incoming state observed near source ${openingState.time.toFixed(3)}s (context only, do not replay earlier action): ${openingState.text}`
        : "",
      "Any intermediate source-pose images show timing/composition only; use the replacement character references for identity.",
      segment.continuationOf
        ? `Continue only the previous generated segment ${segment.continuationOf} in this same shot.`
        : previous
          ? segment.overlap > 0
            ? `Continue the same camera shot with ${segment.overlap.toFixed(3)}s controlled overlap after segment ${previous.id}. Match the source pose at this segment's start; it precedes the previous clip's final pose, so do not reuse that final image as the first. Do not reset to setup or replay the entire reaction. The assembler trims the repeated overlap.`
            : `Continue the same camera shot after segment ${previous.id}. Keep its outgoing pose, hands/limbs, prop positions and object damage/condition. Use the shared boundary frame as this segment's first frame. Do not reset to setup, repair damaged props or replay the prior reaction.`
          : "Begin a new shot from its attached reference. Do not continue across a camera cut.",
      `Dialogue (verbatim; preserve Filipino, English, Taglish and profanity):\n${dialogue.join("\n") || "No dialogue in this interval."}`,
      version.audioMode === "SILENT"
        ? "Generate a silent performance."
        : turns.length
          ? "Use dialogue timing to guide mouth movement and emotion. Final audio will be applied separately in the assembler; do not change words or timing."
          : "No spoken dialogue is supplied. Match only visible mouth expressions; final soundtrack will be applied separately.",
      segment.strategy === "FIRST_LAST"
        ? "Use the attached replaced first and last frames as exact composition endpoints."
        : "Use the attached character and frame references to maintain identity and composition.",
      segment.strategy === "ANIMATION_2D"
        ? "Use a reusable 2D character rig, matching source motion and camera. Render externally and import the clip."
        : "",
      `The usable source interval is ${(segment.end - segment.start).toFixed(3)}s; hold the final pose for any remaining generated duration. No extra cut, captions or additional dialogue.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
