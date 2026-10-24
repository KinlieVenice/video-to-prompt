import { z } from "zod";
import { guidedDefaultsSchema } from "./guided";
import { flowCredits } from "./services/ScenePlannerService";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const nicheSchema = z.object({
  id,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(10).max(12000),
  artStyle: z.string().trim().max(3000).default(""),
  duration: z.number().int().min(4).max(180),
  language: z.string().trim().min(1).max(100),
  characterId: id,
  defaults: guidedDefaultsSchema,
  audioMode: z.enum(["CHARACTER_TTS", "FLOW_CLIPS", "UPLOADED", "SILENT"]),
  uploadedAudio: z
    .string()
    .regex(/^[a-f0-9-]{36}\.(wav|mp3|m4a|flac|ogg)$/)
    .optional(),
  referenceIds: z.array(id).max(6),
  maxCredits: z.number().finite().min(0).max(10000),
  updatedAt: z.string(),
});
export type Niche = z.infer<typeof nicheSchema>;
export const plannedSceneSchema = z.object({
  description: z.string().trim().min(1).max(3000),
  firstFrame: z.string().trim().min(1).max(3000),
  lastFrame: z.string().trim().min(1).max(3000),
  camera: z.string().trim().min(1).max(1000),
  lighting: z.string().trim().min(1).max(1000),
  motion: z.string().trim().min(1).max(3000),
  narration: z.string().trim().max(1500),
  emotion: z.string().trim().max(300),
});
export const contentPlanSchema = z.object({
  artStyle: z.string().trim().max(3000).default(""),
  title: z.string().trim().min(1).max(200),
  hook: z.string().trim().max(1000),
  summary: z.string().trim().max(3000),
  scenes: z.array(plannedSceneSchema).min(1).max(45),
});
export type ContentPlan = z.infer<typeof contentPlanSchema>;
export type NicheVideo = {
  id: string;
  nicheId: string;
  topic: string;
  nicheSnapshot: Niche;
  state: "PLANNING" | "READY" | "FAILED";
  referenceRevisions: { id: string; revision: number }[];
  plan?: ContentPlan;
  projectId?: string;
  versionId?: string;
  runId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export function contentIntervals(duration: number, maximum: number) {
  const count = Math.ceil(duration / maximum),
    frames = Math.round(duration * 30);
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const remaining = count - i - 1;
    const end =
      duration >= count * 4
        ? Math.min(cursor + maximum, duration - remaining * 4)
        : Math.round(((i + 1) * frames) / count) / 30;
    const interval = { start: cursor, end };
    cursor = end;
    return interval;
  });
}
export function estimateNicheCredits(
  niche: Pick<Niche, "duration" | "defaults">,
) {
  return contentIntervals(niche.duration, niche.defaults.maxDuration).reduce(
    (sum, interval) => {
      const duration =
        niche.defaults.target === "VEO_LITE"
          ? 8
          : [4, 6, 8, 10].find(
              (d) => d + 0.000001 >= interval.end - interval.start,
            ) || niche.defaults.maxDuration;
      return (
        sum +
        flowCredits(
          niche.defaults.target,
          duration,
          false,
          niche.defaults.creditOverride,
        )
      );
    },
    0,
  );
}
