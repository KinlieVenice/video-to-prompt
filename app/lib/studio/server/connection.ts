import {
  connectionSchema,
  defaultConnection,
  type RouterConnection,
} from "../connection";
import { routerBaseUrl } from "./openai";

export function resolveRouterConnection(
  input?: RouterConnection,
): RouterConnection {
  const browser = input || defaultConnection();
  // Environment values take precedence, including over older browser settings.
  // The environment key stays on the server and is never included in API state.
  return connectionSchema.parse({
    ...browser,
    baseUrl: process.env.NINE_ROUTER_BASE_URL?.trim() || browser.baseUrl,
    apiKey: process.env.NINE_ROUTER_API_KEY?.trim() || browser.apiKey,
    model: process.env.NINE_ROUTER_MODEL?.trim() || browser.model,
  });
}

export function publicRouterSettings() {
  const connection = resolveRouterConnection();
  return {
    baseUrl: routerBaseUrl(connection.baseUrl),
    model: connection.model,
    serverKeyConfigured: Boolean(process.env.NINE_ROUTER_API_KEY?.trim()),
    environmentBaseUrl: Boolean(process.env.NINE_ROUTER_BASE_URL?.trim()),
    environmentModel: Boolean(process.env.NINE_ROUTER_MODEL?.trim()),
  };
}
