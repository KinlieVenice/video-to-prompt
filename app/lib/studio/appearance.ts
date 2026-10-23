import type { Version } from "./types";

export function appearanceNotes(version: Pick<Version, "appearanceNotes">) {
  return Object.fromEntries(
    Object.entries(version.appearanceNotes || {})
      .map(([actor, note]) => [actor, note.trim()] as const)
      .filter(([, note]) => note.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function appearanceChanged(before: Version, after: Version) {
  return (
    JSON.stringify(appearanceNotes(before)) !==
    JSON.stringify(appearanceNotes(after))
  );
}

export function actorAppearanceInstructions(
  version: Version,
  actorId: string,
  actorName: string,
  characterName: string,
) {
  const note = appearanceNotes(version)[actorId];
  if (!note || !version.mappings[actorId]) return "";
  return `APPEARANCE FOR ${actorName} AS ${characterName} (this assignment only): ${JSON.stringify(note)}. Apply these requested visual changes while preserving the saved character's identity and all unmodified features. These explicit details override conflicting accessory or clothing details in this actor's source and character reference images. Keep the added appearance consistent across frames and shots. Show normally hidden details only when the original pose naturally reveals them; preserve mouth shapes and lip timing without forcing an extra smile or mouth opening. Do not apply these changes to other actors or alter their voices, actions or background.`;
}
