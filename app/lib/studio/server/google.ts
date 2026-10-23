export type OutputBlock = {
  type: string;
  text?: string;
  data?: string;
  mime_type?: string;
};
export type Interaction = {
  status?: string;
  steps?: { type: string; content?: OutputBlock[] }[];
  usage?: unknown;
};
export async function googleRequest<T>(
  endpoint: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
  if (!apiKey.trim())
    throw new Error("Add a Gemini API key in Settings first.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${endpoint}`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!response.ok) {
    // Do not echo provider URLs, request bodies, or API keys in errors.
    const error = await response.json().catch(() => ({}));
    const message = String(
      error.error?.message || response.statusText,
    ).replaceAll(apiKey, "[redacted]");
    throw new Error(`Gemini ${response.status}: ${message.slice(0, 600)}`);
  }
  return response.json();
}
export function blocks(result: Interaction) {
  if (result.status && result.status !== "completed")
    throw new Error(
      `Gemini response status: ${result.status}. No output was saved.`,
    );
  return (result.steps || [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content || []);
}
export function jsonOutput(result: Interaction): unknown {
  const text = blocks(result)
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("");
  if (!text) throw new Error("Gemini returned no analysis text.");
  return JSON.parse(
    text
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "")
      .trim(),
  );
}
