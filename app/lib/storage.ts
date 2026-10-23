const KEY_API_KEY = "v2p:gemini_api_key";
const KEY_MODEL = "v2p:gemini_model";

export const DEFAULT_MODEL = "gemini-3.8-flash";

export const SUPPORTED_MODELS = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (video + audio analysis)",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro (recommended — best video understanding)",
  },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (faster, cheaper)" },
] as const;

export function loadApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY_API_KEY) ?? "";
}

export function saveApiKey(key: string): void {
  if (typeof window === "undefined") return;
  if (key) window.localStorage.setItem(KEY_API_KEY, key);
  else window.localStorage.removeItem(KEY_API_KEY);
}

export function loadModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  const saved = window.localStorage.getItem(KEY_MODEL);
  return SUPPORTED_MODELS.some((model) => model.id === saved)
    ? saved!
    : DEFAULT_MODEL;
}

export function saveModel(model: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY_MODEL, model);
}
