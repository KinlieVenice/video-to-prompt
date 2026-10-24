import type { Analysis, Character, Segment, Version } from "../types";
import { STRATEGIES } from "../types";
import { segmentMotionText, segmentOpeningState } from "../motion";
import { shotPredecessor } from "../references";
import { actorAppearanceInstructions } from "../appearance";
import {
  backgroundInstructions,
  expressionInstructions,
  sceneCompletionInstructions,
  visualDirection,
} from "../visualDirection";

export class PromptGenerationService {
  static generate(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    characters: Character[],
    flow?: { resolution: "360p" | "720p"; nativeVoice: boolean },
  ): string {
    const shot = analysis.shots.find((s) => s.id === segment.shotId)!;
    const turns = analysis.turns.filter(
      (t) => t.end > segment.start && t.start < segment.end,
    );
    const openingState = segmentOpeningState(shot, segment.start);
    const previous = shotPredecessor(version, segment);
    const direction = visualDirection(version);
    const cast = analysis.speakers.map((s) => {
      const character = characters.find((c) => c.id === version.mappings[s.id]);
      return character
        ? `${s.name} (${s.description}) becomes ${character.name}: ${character.description}. Visual style: ${character.visualStyle}. Keep source clothing where relevant, except for explicitly requested appearance changes; use the attached character reference images for identity. ${actorAppearanceInstructions(version, s.id, s.name, character.name)}`
        : `${s.name}: ${s.description}. No replacement assigned.`;
    });
    const dialogue = turns.map((t) => {
      const speaker =
        analysis.speakers.find((s) => s.id === t.speakerId)?.name ||
        t.speakerId;
      return `${Math.max(0, t.start - segment.start).toFixed(2)}–${Math.min(segment.end - segment.start, t.end - segment.start).toFixed(2)}s, ${speaker}, ${t.emotion || "natural"}: ${JSON.stringify(t.text)}. ${t.gesture}`;
    });
    return [
      `Create ${segment.duration} seconds, ${version.aspect}. Target: ${version.target === "VEO_LITE" ? "Google Flow Veo 3.1 Lite" : `Google Flow Gemini Omni Flash (${flow?.resolution || "720p"})`}. Strategy: ${STRATEGIES[segment.strategy]}.`,
      `Reenact source interval ${segment.start.toFixed(3)}–${segment.end.toFixed(3)}s as one continuous camera shot. Preserve composition, relevant clothing, blocking, choreography, action props, source rhythm and camera angle.`,
      ...cast,
      direction.backgroundMode === "NEW"
        ? `Source performance context (use for action and prop context; replace its environment): ${shot.description}`
        : `Scene: ${shot.description}`,
      `Camera: ${shot.camera}. ${direction.backgroundMode === "SOURCE" ? `Lighting: ${shot.lighting}.` : "Use lighting consistent with the selected new environment."}`,
      backgroundInstructions(version),
      sceneCompletionInstructions(version),
      expressionInstructions(version),
      `Motion plan (seconds from THIS segment's start; execute in order):\n${segmentMotionText(shot, segment)}`,
      "Activity ranges describe sustained movement, not action onset. Separate onset brackets are estimates supported by snapshots. Preserve cause before reaction; do not invent missing transitions or speed up the main action to fill padding.",
      openingState
        ? `Incoming state observed near source ${openingState.time.toFixed(3)}s (context only, do not replay earlier action): ${openingState.text}`
        : "",
      `Any intermediate source-pose images show timing/composition only; use the replacement character references for identity.${direction.backgroundMode === "NEW" ? " Do not restore the original background from source evidence; maintain the new environment shown in the generated reference frames. Incoming state descriptions preserve performer and action-prop state, with environment controlled by the new-background direction above." : ""}`,
      segment.continuationOf
        ? `Continue only the previous generated segment ${segment.continuationOf} in this same shot.`
        : previous
          ? segment.overlap > 0
            ? `Continue the same camera shot with ${segment.overlap.toFixed(3)}s controlled overlap after segment ${previous.id}. Match the source pose at this segment's start; it precedes the previous clip's final pose, so do not reuse that final image as the first. Do not reset to setup or replay the entire reaction. The assembler trims the repeated overlap.`
            : `Continue the same camera shot after segment ${previous.id}. Keep its outgoing pose, hands/limbs, prop positions and object damage/condition. Use the shared boundary frame as this segment's first frame. Do not reset to setup, repair damaged props or replay the prior reaction.`
          : "Begin a new shot from its attached reference. Do not continue across a camera cut.",
      `Dialogue (verbatim; preserve Filipino, English, Taglish and profanity):\n${dialogue.join("\n") || "No dialogue in this interval."}`,
      flow?.nativeVoice
        ? "Use the attached Flow voice for the supplied verbatim dialogue, matching its timestamps and performance. Do not add or rewrite words."
        : version.audioMode === "SILENT"
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
