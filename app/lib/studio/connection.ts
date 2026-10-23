import { z } from "zod";

export const connectionSchema = z.object({
  baseUrl: z.string().trim().max(500).default("http://127.0.0.1:20128/v1"),
  apiKey: z.string().trim().max(500).default(""),
  model: z.string().trim().max(200).default(""),
  transcription: z.enum(["LOCAL", "MANUAL", "ROUTER"]).default("LOCAL"),
  transcriptionModel: z.string().trim().max(200).default(""),
  language: z.enum(["auto", "tl", "en"]).default("auto"),
  imagesEnabled: z.boolean().default(false),
  ttsEnabled: z.boolean().default(false),
});
export type RouterConnection = z.infer<typeof connectionSchema>;
export type PublicRouterSettings = {
  baseUrl: string;
  model: string;
  serverKeyConfigured: boolean;
  environmentBaseUrl: boolean;
  environmentModel: boolean;
};
export const defaultConnection = (): RouterConnection =>
  connectionSchema.parse({});

const STORAGE_KEY = "studio:9router:connection";
export function loadConnection(
  settings?: PublicRouterSettings,
): RouterConnection {
  let connection: RouterConnection;
  try {
    connection = connectionSchema.parse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
    );
  } catch {
    connection = defaultConnection();
  }
  return {
    ...connection,
    ...(settings?.environmentBaseUrl ? { baseUrl: settings.baseUrl } : {}),
    ...(settings?.environmentModel ? { model: settings.model } : {}),
    ...(settings?.serverKeyConfigured ? { apiKey: "" } : {}),
  };
}
export function saveConnection(connection: RouterConnection) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(connectionSchema.parse(connection)),
  );
}
