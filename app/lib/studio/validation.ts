import { z } from "zod";
const text = z.string().max(20_000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const time = z.number().finite().min(0).max(86_400);
const range = { start: time, end: time };
export const speakerSchema = z.object({ id, name: text, description: text });
export const shotSchema = z.object({
  id,
  ...range,
  description: text,
  camera: text,
  motion: text,
  lighting: text,
});
export const turnSchema = z.object({
  id,
  ...range,
  speakerId: id,
  text,
  emotion: text,
  gesture: text,
  reviewed: z.boolean().default(false),
});
export const analysisEditSchema = z.object({
  shots: z.array(shotSchema).min(1).max(2000),
  speakers: z.array(speakerSchema).max(200),
  turns: z.array(turnSchema).max(5000),
});
export const voiceSchema = z.object({
  provider: z.literal("GEMINI"),
  model: z.enum(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]),
  kind: z.enum(["PREBUILT", "DESIGNED"]),
  voiceId: z.string().min(1).max(200),
  language: z.enum(["auto", "fil-PH", "en-US"]),
  style: text,
  speed: z.number().min(0.5).max(2),
  designPrompt: text,
  previewAsset: z.string().optional(),
});
export const characterSchema = z.object({
  id,
  name: z.string().trim().min(1).max(200),
  description: text,
  visualStyle: text,
  references: z.array(z.string()).max(12),
  voice: voiceSchema,
  updatedAt: z.string(),
});
export const versionEditSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mappings: z.record(id, id),
  audioMode: z.enum(["ORIGINAL", "CHARACTER_TTS", "UPLOADED", "SILENT"]),
  audioOffset: z.number().min(-600).max(600),
  target: z.enum(["VEO_LITE", "OMNI_FLASH"]),
  maxDuration: z.union([
    z.literal(4),
    z.literal(6),
    z.literal(8),
    z.literal(10),
  ]),
  overlap: z.number().min(0).max(1),
  strategy: z.enum([
    "FRAMES",
    "FIRST_LAST",
    "INGREDIENTS",
    "EXTEND",
    "ANIMATION_2D",
  ]),
  ultra: z.boolean(),
  creditOverride: z.number().min(0).max(10000).optional(),
  aspect: z.enum(["9:16", "16:9"]),
  subtitles: z.boolean(),
  disclosure: z.boolean(),
  turnTiming: z.record(
    id,
    z.object({
      offset: z.number().min(-600).max(600),
      speed: z.number().min(0.5).max(2),
    }),
  ),
});
export function validateTimeline(
  edited: z.infer<typeof analysisEditSchema>,
  duration: number,
) {
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(edited.shots.map((s) => s.id)) ||
    !unique(edited.turns.map((t) => t.id)) ||
    !unique(edited.speakers.map((s) => s.id))
  )
    throw new Error("Timeline IDs must be unique.");
  const shots = [...edited.shots].sort((a, b) => a.start - b.start);
  if (
    Math.abs(shots[0].start) > 0.002 ||
    Math.abs(shots.at(-1)!.end - duration) > 0.002
  )
    throw new Error("Shots must cover the full source from 0 to its duration.");
  for (const [i, shot] of shots.entries()) {
    if (shot.end <= shot.start || shot.end > duration + 0.002)
      throw new Error("Invalid shot duration.");
    if (i && Math.abs(shots[i - 1].end - shot.start) > 0.002)
      throw new Error("Shots must meet at cuts without gaps or overlap.");
  }
  for (const turn of edited.turns) {
    if (turn.end <= turn.start || turn.end > duration + 0.002)
      throw new Error("Dialogue timestamps must be inside the source.");
    if (!edited.speakers.some((s) => s.id === turn.speakerId))
      throw new Error("Each dialogue line must have an existing speaker.");
  }
  return { ...edited, shots };
}
