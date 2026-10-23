import type { RouterConnection } from "../connection";

export type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } };

export function routerBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid local 9router base URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "9router must use a loopback HTTP(S) URL without credentials, query or fragment.",
    );
  return url.toString().replace(/\/+$/, "");
}

export async function routerRequest(
  connection: RouterConnection,
  endpoint: string,
  body?: unknown,
): Promise<Response> {
  const base = routerBaseUrl(connection.baseUrl);
  const headers: Record<string, string> = {};
  if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${base}/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Could not reach 9router, or the request timed out. Start 9router and check its base URL and logs.",
    );
  }
  if (!response.ok) {
    // Provider errors can echo credentials and media. Keep raw errors in 9router's own logs.
    await response.body?.cancel();
    const hint =
      response.status === 401 || response.status === 403
        ? "Check the router key and connected account."
        : response.status === 429
          ? "The selected route is rate limited; wait before retrying."
          : "Check the selected model's capabilities and 9router logs. No fallback provider was requested by the studio.";
    throw new Error(`9router ${response.status} (${endpoint}): ${hint}`);
  }
  return response;
}

export async function routerModels(connection: RouterConnection) {
  const result = await (await routerRequest(connection, "models")).json();
  if (!Array.isArray(result.data))
    throw new Error("9router returned an invalid model list.");
  return [
    ...new Set<string>(
      result.data.flatMap((m: { id?: unknown } | null) =>
        m && typeof m.id === "string" && m.id.length <= 200 ? [m.id] : [],
      ),
    ),
  ].sort();
}

export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error(
      "The model did not return valid analysis JSON. No analysis was saved; retry or change the model.",
    );
  }
}

export async function chatJson(
  connection: RouterConnection,
  content: ChatContent[],
): Promise<unknown> {
  if (!connection.model)
    throw new Error("Select your OpenAI model in API & model settings first.");
  // 9router translates this endpoint for its Codex subscription connection.
  // Avoid optional temperature/response_format parameters unsupported by some routes.
  const response = await routerRequest(connection, "chat/completions", {
    model: connection.model,
    stream: false,
    store: false,
    messages: [{ role: "user", content }],
  });
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason && choice.finish_reason !== "stop")
    throw new Error(
      "The model did not complete the analysis. Retry with a smaller source or another model.",
    );
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error(
      "9router returned no analysis text. Select a vision-capable OpenAI model.",
    );
  return parseJsonText(text);
}
