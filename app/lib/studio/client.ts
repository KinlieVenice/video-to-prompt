import type { StudioState } from "./types";
export type StudioResponse = StudioState & {
  error?: string;
  asset?: string;
  projectId?: string;
  versionId?: string;
  ffmpegReady?: boolean;
};
export async function studioRequest(
  action: string,
  payload: Record<string, unknown> = {},
  file?: File,
): Promise<StudioResponse> {
  const form = new FormData();
  form.set("action", action);
  form.set("payload", JSON.stringify(payload));
  if (file) form.set("file", file);
  const response = await fetch("/api/studio", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Studio request failed.");
  return data;
}
