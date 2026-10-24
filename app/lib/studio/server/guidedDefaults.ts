import { guidedDefaultsSchema } from "../guided";
import { z } from "zod";

export function nicheDefaults(
  env: Record<string, string | undefined> = process.env,
) {
  return z
    .object({
      duration: z.coerce.number().int().min(4).max(180),
      language: z.string().trim().min(1).max(100),
      artStyle: z.string().trim().max(3000),
    })
    .parse({
      duration: env.STUDIO_DEFAULT_NICHE_DURATION || 30,
      language: env.STUDIO_DEFAULT_NICHE_LANGUAGE || "English",
      artStyle: env.STUDIO_DEFAULT_NICHE_ART_STYLE || "",
    });
}

export function guidedDefaults(
  env: Record<string, string | undefined> = process.env,
) {
  const get = (name: string) =>
    env[`STUDIO_DEFAULT_${name}`]?.trim() || undefined;
  const numeric = (name: string) =>
    get(name) === undefined ? undefined : Number(get(name));
  const completion = get("COMPLETE_SCENE");
  if (completion && !["true", "false"].includes(completion))
    throw new Error("STUDIO_DEFAULT_COMPLETE_SCENE must be true or false.");
  return guidedDefaultsSchema.parse({
    target: get("FLOW_MODEL"),
    resolution: get("FLOW_RESOLUTION"),
    maxDuration: numeric("MAX_DURATION"),
    strategy: get("STRATEGY"),
    overlap: numeric("OVERLAP"),
    aspect: get("ASPECT"),
    expression: get("EXPRESSION"),
    backgroundMode: get("BACKGROUND_MODE"),
    backgroundPrompt: get("BACKGROUND_PROMPT"),
    completeScene: completion === undefined ? undefined : completion === "true",
    imageModel: get("IMAGE_MODEL"),
    audioMode: get("AUDIO_MODE"),
    creditOverride: numeric("CREDIT_OVERRIDE"),
  });
}
