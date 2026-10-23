import type { Version, VisualDirection } from "./types";

// Versions saved before these controls retain their original matching behavior.
export function visualDirection(
  version: Pick<Version, "visualDirection">,
): VisualDirection {
  return version.visualDirection
    ? {
        backgroundMode: version.visualDirection.backgroundMode,
        backgroundPrompt: version.visualDirection.backgroundPrompt.trim(),
        expression: version.visualDirection.expression,
        completeScene: version.visualDirection.completeScene ?? false,
      }
    : {
        backgroundMode: "SOURCE",
        backgroundPrompt: "",
        expression: "MATCH_SOURCE",
        completeScene: false,
      };
}

export function visualDirectionChanged(before: Version, after: Version) {
  return (
    JSON.stringify(visualDirection(before)) !==
    JSON.stringify(visualDirection(after))
  );
}

export function backgroundInstructions(
  version: Pick<Version, "visualDirection">,
) {
  const direction = visualDirection(version);
  return direction.backgroundMode === "SOURCE"
    ? `BACKGROUND — MATCH SOURCE: Reproduce the visible original background, environment layout, lighting, colors, furniture and prop placement as closely as possible. Preserve source composition, camera angle, actor scale, blocking and relevant clothing except for explicit per-actor appearance changes. Change mapped character identities, requested actor appearance details and the selected facial expression intensity.${direction.completeScene ? " Scene completion may extend artificial padding or truncated scene edges as directed below; retain the visible setting." : " Retain the original crop and borders; do not invent unseen scenery."}`
    : `BACKGROUND — NEW ENVIRONMENT: Replace the source background with this environment: ${direction.backgroundPrompt || "[Describe the new background before generation]"}. Keep the chosen replacement characters and their reference identities. Preserve source composition, camera angle, actor scale, blocking, relevant clothing, dance floor contact and all foreground objects needed for the action. Adapt environmental lighting and shadows to the new setting while keeping characters clearly visible. Maintain the same environment design, layout and lighting across frames and segments; adapt its view to each source camera angle. Original scene descriptions and source-pose images provide action and composition context only; the chosen new environment overrides their background and lighting. Do not introduce extra people or action-changing props.`;
}

export function sceneCompletionInstructions(
  version: Pick<Version, "visualDirection" | "aspect">,
) {
  if (!visualDirection(version).completeScene) return "";
  return `SCENE UNDERSTANDING & COMPLETION: Study the entire source image and scene context to understand the camera perspective, room or outdoor layout, object geometry, supporting surfaces and how the performer interacts with them. Compose a full ${version.aspect} frame. Identify artificial black bars, blank padding and scene objects truncated by crop or padded edges. Continue the scene naturally into those missing canvas areas: extend the existing object geometry, supports, surfaces and perspective from their visible edges, with coherent material, scale, shadows and lighting. Preserve the visible performer silhouette, body pose, hand contact, action props and spatial relationships. Do not replace missing scenery with another plain black band. Genuine dark walls, clothing, shadows and intentional dark backgrounds are scene content, not automatically padding; preserve them when the visual context supports that interpretation. Unseen areas are plausible inferred continuation, not observed source detail. Keep the completed geometry consistent in both endpoint references and all generated frames. Apply the selected background policy: continue the original setting in source mode, or integrate the continued foreground objects into the chosen new setting in new-background mode. Do not add people, invent hidden actions or change the performance.`;
}

export function expressionInstructions(
  version: Pick<Version, "visualDirection">,
) {
  const expression = visualDirection(version).expression;
  const level =
    expression === "MATCH_SOURCE"
      ? "EXPRESSION — MATCH SOURCE: Match the observed facial expressions, emotional intensity and reactions without embellishment."
      : expression === "SUBTLE"
        ? "EXPRESSION — SLIGHTLY MORE EXPRESSIVE: Make the existing source emotion a little more readable through slightly clearer eyes, eyebrow shapes, natural facial tension and subtle head emphasis within each existing beat. Keep the same emotional meaning; do not turn sadness, fear or anger into a smile."
        : "EXPRESSION — MORE EXPRESSIVE: Give the existing emotion stronger, clearly readable eyes, eyebrows and facial reactions, with restrained head emphasis inside the existing beats. Keep the original emotional meaning and character identity; avoid unrelated expressions or a constant exaggerated grin.";
  return `${level} Apply expression changes only to mapped replacement characters. Preserve body poses, dance choreography, footwork, hand positions, prop contact, action order, onset timing and source rhythm. Add no new actions, reactions, dialogue or vocalizations. Preserve speech mouth shapes and lip timing; facial emphasis must not change the words or pace.`;
}
