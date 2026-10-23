import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { run } from "../../app/lib/studio/server/ffmpeg";

test("environment router settings appear without exposing the server key", async ({
  page,
}) => {
  await page.route("**/api/studio", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        json: {
          projects: [],
          analyses: [],
          characters: [],
          ffmpegReady: true,
          routerSettings: {
            baseUrl: "http://127.0.0.1:20128/v1",
            model: "cx/env-vision",
            serverKeyConfigured: true,
            environmentBaseUrl: true,
            environmentModel: true,
          },
        },
      });
    else await route.continue();
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "studio:9router:connection",
      JSON.stringify({ apiKey: "stale-browser-key", model: "stale-model" }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".key-status")).toContainText("OpenAI via 9router");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("9router API key", { exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("9router API key", { exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByText(
      "9router API key loaded from .env.local. Its value stays on the server.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("OpenAI analysis model", { exact: true }),
  ).toHaveValue("cx/env-vision");
});

test("9router settings discover models and persist independently of Gemini credentials", async ({
  page,
}) => {
  await page.route("**/api/studio", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes('name="action"\r\n\r\nmodels')
    ) {
      await route.fulfill({
        json: {
          projects: [],
          analyses: [],
          characters: [],
          models: ["cx/test-vision"],
        },
      });
    } else await route.continue();
  });
  await page.addInitScript(() =>
    localStorage.setItem("v2p:gemini_api_key", "old-gemini-key"),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "OpenAI through 9router" }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("9router API key", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("9router API key", { exact: true })
    .fill("local-router-key");
  await dialog.getByRole("button", { name: "Connect & load models" }).click();
  await expect(dialog.getByRole("status")).toContainText("Found 1 models");
  await dialog
    .getByLabel("OpenAI analysis model", { exact: true })
    .fill("cx/test-vision");
  await dialog.getByLabel("Transcript source").selectOption("MANUAL");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".key-status")).toContainText("OpenAI via 9router");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    dialog.getByLabel("9router API key", { exact: true }),
  ).toHaveValue("local-router-key");
  await expect(dialog.getByLabel("Transcript source")).toHaveValue("MANUAL");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("local studio: upload, corrections, reusable cast, Flow import and playable MP4", async ({
  page,
}) => {
  const fixture = path.resolve(".tmp/e2e-fixture.mp4");
  await mkdir(path.dirname(fixture), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    "4",
    fixture,
  ]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Same scene. A whole new cast." }),
  ).toBeVisible();
  await page.screenshot({ path: ".tmp/studio-desktop.png", fullPage: true });
  await page.locator(".upload-zone input").setInputFiles(fixture);
  await expect(
    page.getByRole("heading", { name: "Start with what happened." }),
  ).toBeVisible();
  await expect(page.locator(".shot-strip a")).toHaveCount(2);
  await page.getByRole("button", { name: "Add actor", exact: true }).click();
  await page.getByRole("button", { name: "Add turn", exact: true }).click();
  await page
    .getByLabel("Dialogue line 1", { exact: true })
    .fill("Kumusta, ready na tayo!");
  await page.getByLabel("Start of line 1", { exact: true }).fill("0.5");
  await page.getByLabel("End of line 1", { exact: true }).fill("1.5");
  await page
    .getByRole("button", { name: "Save transcript & timeline" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save transcript & timeline" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /Character library Cast any character/ })
    .click();
  await page
    .getByRole("button", { name: "New character", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Browser test performer");
  await page
    .getByLabel("Character description", { exact: true })
    .fill("A character created by the user, with no fixed identity.");
  await page.getByLabel("Visual style", { exact: true }).fill("Illustrated");
  await page
    .getByRole("button", { name: "Save character", exact: true })
    .click();
  await expect(
    page
      .locator(".character-tile")
      .filter({ hasText: "Browser test performer" }),
  ).toBeVisible();
  const characterId = await page
    .getByLabel("Replace Actor 1 with")
    .locator("option")
    .filter({ hasText: "Browser test performer" })
    .getAttribute("value");
  await page.getByLabel("Replace Actor 1 with").selectOption(characterId!);
  await page
    .getByRole("button", { name: "Save version settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  await page
    .getByRole("button", { name: "Plan segments", exact: true })
    .click();
  await expect(page.locator(".segment-card")).toHaveCount(2);
  const segments = page.locator(".segment-card");
  await segments
    .nth(0)
    .getByRole("button", { name: "Extract original frames", exact: true })
    .click();
  await expect(segments.nth(0).locator(".frame-pair img")).toHaveCount(2);
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/Browser test performer/);
  for (let i = 0; i < 2; i++) {
    await segments.nth(i).locator(".clip-import input").setInputFiles(fixture);
    await expect(
      segments.nth(i).getByText("Generated clip ready", { exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: /Assemble & export Make the final cut/ })
    .click();
  await page
    .getByRole("button", { name: "Assemble final MP4", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download MP4", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  const video = page.locator(".final-preview");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(
    4,
    1,
  );
  await page.reload();
  await page
    .getByRole("button", { name: /Assemble & export Make the final cut/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Download MP4", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".tmp/studio-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("source ranges persist, shot splits can be undone or removed, and export uses the chosen duration", async ({
  page,
}) => {
  const fixture = path.resolve(".tmp/range-e2e.mp4");
  await mkdir(path.dirname(fixture), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=160x90:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    "4",
    fixture,
  ]);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled();
  await page.locator('input.hidden[type="file"]').setInputFiles(fixture);
  await expect(page.locator(".project-ribbon")).toContainText("range-e2e.mp4");
  await expect(page.locator(".shot-strip a")).toHaveCount(1);
  await page.getByLabel("Split at").fill("2");
  await page.getByRole("button", { name: "Split shot", exact: true }).click();
  await expect(page.locator(".shot-strip a")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo split", exact: true }).click();
  await expect(page.locator(".shot-strip a")).toHaveCount(1);
  await page.getByRole("button", { name: "Split shot", exact: true }).click();
  await page
    .getByRole("button", { name: "Save transcript & timeline" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save transcript & timeline" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove cut at 2.00s", exact: true })
    .click();
  await expect(page.locator(".shot-strip a")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Save transcript & timeline" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save transcript & timeline" }),
  ).toBeDisabled();
  await page.getByLabel("Reenact from (source seconds)").fill("0.75");
  await page.getByLabel("Reenact until (source seconds)").fill("3.5");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply range", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".project-ribbon")).toContainText("2.75s output");
  await expect(page.locator(".project-ribbon")).toContainText(
    "Full source 4.00s",
  );
  await page.reload();
  await expect(page.locator(".shot-strip a")).toHaveCount(1);
  await expect(page.getByLabel("Reenact from (source seconds)")).toHaveValue(
    "0.75",
  );
  await expect(page.getByLabel("Reenact until (source seconds)")).toHaveValue(
    "3.5",
  );
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  await page
    .getByRole("button", { name: "Plan segments", exact: true })
    .click();
  await expect(page.locator(".segment-card")).toHaveCount(1);
  await expect(page.getByLabel("Flow prompt for segment 1")).toHaveValue(
    /source interval 0.750–3.500s/,
  );
  await page.locator(".segment-card .clip-import input").setInputFiles(fixture);
  await expect(
    page.getByText("Generated clip ready", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Assemble & export Make the final cut/ })
    .click();
  await page
    .getByRole("button", { name: "Assemble final MP4", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download MP4", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  const video = page.locator(".final-preview");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(
    2.75,
    1,
  );
});

test("motion analysis can be refined and reviewed without losing manual beat corrections", async ({
  page,
}) => {
  const fixture = path.resolve(".tmp/motion-e2e.mp4");
  await mkdir(path.dirname(fixture), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x90:r=30:d=4",
    "-vf",
    "drawbox=x=20:y=20:w=50:h=30:color=white:t=fill:enable='between(t,1,3)'",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    fixture,
  ]);
  const router = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const content = JSON.parse(Buffer.concat(chunks).toString()).messages[0]
      .content;
    const prompt = content[0].text as string;
    const start = Number(prompt.match(/Source interval ([\d.]+)-/)?.[1] || 0);
    const refined = prompt.includes("REFINEMENT PASS");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                description: "A tabletop pose",
                camera: "Static",
                lighting: "Even",
                speakers: [],
                motionBeats: [
                  {
                    start: start + 0.5,
                    end: start + (refined ? 0.75 : 1),
                    anchorTime: start + (refined ? 0.75 : 1),
                    action: "The object changes position",
                    timingKind: "TRANSITION",
                    onset: {
                      start: start + 0.5,
                      end: start + (refined ? 0.75 : 1),
                    },
                    stateBefore: "Object at original position",
                    stateAfter: "Object shifted",
                    phase: "ACTION",
                    importance: "KEY",
                    confidence: "MEDIUM",
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => router.listen(0, "127.0.0.1", resolve));
  const port = (router.address() as { port: number }).port;
  try {
    await page.addInitScript(
      (baseUrl) =>
        localStorage.setItem(
          "studio:9router:connection",
          JSON.stringify({
            baseUrl,
            model: "cx/test-vision",
            transcription: "MANUAL",
          }),
        ),
      `http://127.0.0.1:${port}/v1`,
    );
    await page.goto("/");
    await page.locator('input.hidden[type="file"]').setInputFiles(fixture);
    await page
      .getByRole("button", { name: "Analyze with OpenAI", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refine motion timing", exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await page
      .getByText("Edit shot boundaries, motion and camera", { exact: true })
      .click();
    await expect(
      page.getByLabel("Motion action 1", { exact: true }),
    ).toHaveValue("The object changes position");
    await expect(
      page.getByLabel("Timing meaning 1", { exact: true }),
    ).toHaveValue("TRANSITION");
    await expect(
      page.getByRole("img", { name: /before evidence for beat 1/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /after evidence for beat 1/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review in slow motion", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".preview-panel video")
          .evaluate((v: HTMLVideoElement) => v.playbackRate),
      )
      .toBe(0.5);
    await page
      .locator(".preview-panel video")
      .evaluate((v: HTMLVideoElement) => v.pause());
    await page
      .getByLabel("Motion action 1", { exact: true })
      .fill("Human verified object movement");
    await page.getByLabel("Onset latest 1", { exact: true }).fill("0.7");
    await page
      .getByLabel("Timing reviewed against source", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Save transcript & timeline", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Refine motion timing", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refine motion timing", exact: true }),
    ).toBeEnabled({ timeout: 45000 });
    await page
      .getByText("Edit shot boundaries, motion and camera", { exact: true })
      .click();
    await expect(
      page.getByLabel("Motion action 1", { exact: true }),
    ).toHaveValue("Human verified object movement");
    await expect(
      page.getByLabel("Onset latest 1", { exact: true }),
    ).toHaveValue("0.7");
    await expect(
      page.getByLabel("Timing reviewed against source", { exact: true }),
    ).toBeChecked();
  } finally {
    router.closeAllConnections();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  }
});
