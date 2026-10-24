import { z } from "zod";

const image = z.string().regex(/^[a-f0-9-]{36}\.(png|jpg|webp)$/);
export const flowSettingsSchema = z.object({
  projectUrl: z.string().trim().max(400).default(""),
  resolution: z.enum(["360p", "720p"]).default("360p"),
  voiceName: z.string().trim().max(100).default(""),
  voiceStyle: z.string().trim().max(1000).default(""),
});
export type FlowSettings = z.infer<typeof flowSettingsSchema>;
export const flowInputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(30000),
    model: z.enum(["OMNI_FLASH", "VEO_LITE"]),
    mode: z.enum(["FRAMES", "FIRST_LAST", "INGREDIENTS"]),
    duration: z.union([
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(10),
    ]),
    aspect: z.enum(["9:16", "16:9"]),
    first: image.optional(),
    last: image.optional(),
    references: z.array(image).max(6).default([]),
    settings: flowSettingsSchema,
  })
  .superRefine((input, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      input.model === "VEO_LITE" &&
      (input.settings.resolution !== "720p" || input.duration !== 8)
    )
      problem(
        "The inspected Veo Lite interface supports 720p and 8 seconds. Select those settings or Omni Flash.",
      );
    if (input.mode !== "INGREDIENTS" && !input.first)
      problem("Generate a replacement first frame before preparing Flow.");
    if (input.mode === "FIRST_LAST" && !input.last)
      problem("Generate a replacement last frame before preparing Flow.");
    if (
      input.settings.voiceName &&
      (input.mode !== "INGREDIENTS" || input.model !== "OMNI_FLASH")
    )
      problem(
        "Flow voice references require Omni Flash Ingredients mode. They cannot be combined with Start/End frames.",
      );
    if (input.settings.voiceName && !input.first && !input.references.length)
      problem("A Flow voice reference also needs a visual ingredient.");
  });
export type FlowInput = z.infer<typeof flowInputSchema>;
export type FlowState =
  | "DRAFT"
  | "PREPARED"
  | "SUBMITTING"
  | "RUNNING"
  | "COMPLETE"
  | "FAILED"
  | "UNKNOWN"
  | "ABANDONED";
export type FlowOperation = {
  state: FlowState;
  mediaId?: string;
  asset?: string;
  error?: string;
};
export type FlowJob = FlowOperation & {
  id: string;
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
  input: FlowInput;
  projectUrl: string;
  quote?: number;
  draftSignature?: string;
  sceneId?: string;
  binding?: {
    projectId: string;
    versionId: string;
    segmentId: string;
    signature: string;
  };
  upscale?: FlowOperation;
};
export function flowProjectUrl(value: string) {
  const url = new URL(value);
  if (
    url.origin !== "https://flow.google.com" ||
    !/^\/project\/[a-f0-9-]{36}\/?$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use a Google Flow project URL: https://flow.google.com/project/<project-id>.",
    );
  return url.origin + url.pathname.replace(/\/$/, "");
}
export function flowCdpEndpoint(value = "http://127.0.0.1:9223") {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "FLOW_CDP_ENDPOINT must be a loopback HTTP browser endpoint with a port.",
    );
  return url.origin;
}
export function mediaState(code: unknown): FlowState {
  if (code === 3) return "COMPLETE";
  if (code === 4 || code === 5 || code === 7) return "FAILED";
  return "RUNNING";
}
// Only decode the selected RPC response. Never retain tokens, headers or raw bodies.
export function rpcPayload(body: string, rpc: string): unknown[] | undefined {
  for (const line of body.split("\n")) {
    if (!line.startsWith("[")) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (
        Array.isArray(row) &&
        row[0] === "wrb.fr" &&
        row[1] === rpc &&
        typeof row[2] === "string"
      ) {
        try {
          const value: unknown = JSON.parse(row[2]);
          if (Array.isArray(value)) return value;
        } catch {
          /* Unknown response stays unresolved. */
        }
      }
    }
  }
}
export function findMedia(value: unknown, id: string): unknown[] | undefined {
  if (!Array.isArray(value)) return;
  if (
    value[0] === id &&
    value.length >= 8 &&
    Array.isArray(value[5]) &&
    Array.isArray(value[5][8])
  )
    return value;
  for (const child of value) {
    const found = findMedia(child, id);
    if (found) return found;
  }
}
export function acceptedMedia(value: unknown[], projectUrl: string) {
  const rows = value[3];
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]))
    return;
  const row = rows[0];
  const projectId = new URL(flowProjectUrl(projectUrl)).pathname
    .split("/")
    .at(-1);
  // Flow's media row is [media ID, project ID, scene ID, ...].
  if (
    typeof row[0] !== "string" ||
    row[1] !== projectId ||
    typeof row[2] !== "string" ||
    !/^[a-f0-9-]{36}$/.test(row[2])
  )
    return;
  return { mediaId: row[0], sceneId: row[2] };
}
export function freeUpscalePrice(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) return;
  if (value[0] === "omni_upsampler_360p" && Array.isArray(value[4])) {
    const prices = value[4].flatMap((tier: unknown) => {
      if (
        !Array.isArray(tier) ||
        !Array.isArray(tier[1]) ||
        !Array.isArray(tier[1][0])
      )
        return [];
      return [tier[1][0][1]];
    });
    return (
      prices.length > 0 &&
      prices.every((price) => typeof price === "number" && price === 0)
    );
  }
  for (const child of value) {
    const found = freeUpscalePrice(child);
    if (found !== undefined) return found;
  }
}
export function findUpscale(
  value: unknown,
  sourceId: string,
): unknown[] | undefined {
  if (!Array.isArray(value)) return;
  if (
    value[0] === `${sourceId}_720p_upsampled` &&
    value.length >= 8 &&
    Array.isArray(value[5]) &&
    Array.isArray(value[5][8])
  )
    return value;
  for (const child of value) {
    const found = findUpscale(child, sourceId);
    if (found) return found;
  }
}
export function creditQuote(text: string) {
  const match = text.trim().match(/^(\d+(?:\.\d+)?) credits?$/i);
  if (!match)
    throw new Error(
      "Flow did not provide a readable credit quote. Nothing was submitted.",
    );
  return Number(match[1]);
}
