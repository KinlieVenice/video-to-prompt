import { newVersion, type Version } from "./types";
import { z } from "zod";

export const GUIDED_IMAGE_MODEL = "cx/gpt-image-2.5-sunburst";
export const guidedDefaultsSchema = z
  .object({
    target: z.enum(["OMNI_FLASH", "VEO_LITE"]).default("OMNI_FLASH"),
    resolution: z.enum(["360p", "720p"]).default("360p"),
    maxDuration: z
      .union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)])
      .default(8),
    strategy: z
      .enum(["FIRST_LAST", "FRAMES", "INGREDIENTS"])
      .default("FIRST_LAST"),
    overlap: z.number().min(0).max(1).default(0),
    aspect: z.enum(["9:16", "16:9"]).default("9:16"),
    expression: z
      .enum(["EXPRESSIVE", "SUBTLE", "MATCH_SOURCE"])
      .default("EXPRESSIVE"),
    backgroundMode: z.enum(["SOURCE", "NEW"]).default("SOURCE"),
    backgroundPrompt: z.string().trim().max(4000).default(""),
    completeScene: z.boolean().default(true),
    imageModel: z.string().trim().min(1).max(200).default(GUIDED_IMAGE_MODEL),
    audioMode: z
      .enum(["ORIGINAL", "CHARACTER_TTS", "UPLOADED", "SILENT", "FLOW_CLIPS"])
      .default("ORIGINAL"),
    creditOverride: z.number().min(0).max(10000).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.target === "VEO_LITE" &&
      (v.resolution !== "720p" || v.maxDuration !== 8)
    )
      ctx.addIssue({
        code: "custom",
        message: "Veo Lite defaults require 720p and 8 seconds.",
      });
    if (v.backgroundMode === "NEW" && !v.backgroundPrompt)
      ctx.addIssue({
        code: "custom",
        message: "A new background default needs a description.",
      });
  });
export type GuidedDefaults = z.infer<typeof guidedDefaultsSchema>;
export function guidedVersion(
  id: string,
  defaults = guidedDefaultsSchema.parse({}),
): Version {
  return {
    ...newVersion(id),
    workflow: "GUIDED",
    target: defaults.target,
    maxDuration: defaults.maxDuration,
    strategy: defaults.strategy,
    overlap: defaults.overlap,
    aspect: defaults.aspect,
    audioMode: defaults.audioMode,
    creditOverride: defaults.creditOverride,
    assemblyTiming: "SOURCE",
    visualDirection: {
      backgroundMode: defaults.backgroundMode,
      backgroundPrompt: defaults.backgroundPrompt,
      expression: defaults.expression,
      completeScene: defaults.completeScene,
    },
    flowSettings: {
      projectUrl: "",
      resolution: defaults.resolution,
      voiceName: "",
      voiceStyle: "",
    },
  };
}
export type StudioRun = {
  id: string;
  projectId: string;
  versionId: string;
  fingerprint: string;
  state: "RUNNING" | "PAUSED" | "COMPLETE";
  stage: "AUDIO" | "FRAMES" | "FLOW" | "ASSEMBLE";
  cursor: number;
  jobs: Record<string, string>;
  reservations: Record<string, number>;
  maxCredits: number;
  imageModel: string;
  message: string;
  error?: string;
  asset?: string;
  createdAt: string;
  updatedAt: string;
};
