import { defineConfig } from "@playwright/test";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
const browserRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "ms-playwright")
  : "";
// Reuse an installed Chromium when this machine already has one; CI can use `playwright install chromium`.
const installed =
  browserRoot && existsSync(browserRoot)
    ? readdirSync(browserRoot)
        .filter((n) => /^chromium-\d+$/.test(n))
        .sort()
        .reverse()
        .map((n) => path.join(browserRoot, n, "chrome-win64", "chrome.exe"))
        .find(existsSync)
    : undefined;
export default defineConfig({
  expect: { timeout: 20000 },
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1050 },
    headless: true,
    launchOptions: installed ? { executablePath: installed } : undefined,
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { STUDIO_DATA_DIR: path.resolve(`.tmp/e2e-data-${Date.now()}`) },
  },
});
