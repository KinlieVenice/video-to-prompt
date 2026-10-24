import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultVoice, newVersion } from "../../app/lib/studio/types";
import { run } from "../../app/lib/studio/server/ffmpeg";
import type { FlowJob } from "../../app/lib/studio/flow";
import {
  guidedDefaultsSchema,
  guidedVersion,
  type StudioRun,
} from "../../app/lib/studio/guided";

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(
    (value) => localStorage.setItem("studio:workflow", value),
    testInfo.title.startsWith("guided upload") ? "GUIDED" : "ADVANCED",
  );
});

test("guided upload asks for cast and audio, skips optional steps, then automatically shows the assembled MP4", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("studio:workflow", "GUIDED"),
  );
  const fixture = path.resolve(".tmp/guided-preview.mp4");
  await mkdir(path.dirname(fixture), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    fixture,
  ]);
  const output = `${randomUUID()}.mp4`,
    image = `${randomUUID()}.png`;
  const version = guidedVersion(randomUUID());
  const character = {
    id: randomUUID(),
    name: "Saved performer",
    description: "A user character",
    visualStyle: "Illustrated",
    references: [image],
    voice: defaultVoice(),
    updatedAt: new Date().toISOString(),
  };
  const project = {
    id: randomUUID(),
    name: "Challenge",
    analysisId: "guided-analysis",
    versions: [version],
    updatedAt: new Date().toISOString(),
  };
  const analysis = {
    id: "guided-analysis",
    sourceName: "challenge.mp4",
    sourceAsset: output,
    sourceHash: "source",
    status: "ANALYZED",
    revision: 1,
    media: { duration: 4, width: 160, height: 90, fps: 30, hasAudio: false },
    speakers: [{ id: "actor", name: "Actor 1", description: "A performer" }],
    turns: [],
    activity: [],
    warnings: [],
    shots: [
      {
        id: "shot",
        start: 0,
        end: 4,
        description: "A dance",
        camera: "Fixed",
        lighting: "Even",
        motion: "Dances",
      },
    ],
  };
  let uploaded = false,
    automatic: StudioRun | undefined,
    advances = 0;
  const snapshot = () => ({
    projects: uploaded ? [project] : [],
    analyses: uploaded ? [analysis] : [],
    characters: [character],
    ffmpegReady: true,
    guidedDefaults: guidedDefaultsSchema.parse({}),
  });
  await page.route("**/api/studio", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postData() || "";
      const payload = JSON.parse(
        body.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] || "{}",
      );
      if (body.includes('name="action"\r\n\r\ncreate_project')) {
        expect(payload.guided).toBe(true);
        uploaded = true;
      }
      if (payload.value) Object.assign(version, payload.value);
      await route.fulfill({
        json: { ...snapshot(), ...(uploaded ? { projectId: project.id } : {}) },
      });
    } else await route.fulfill({ json: snapshot() });
  });
  await page.route("**/api/studio/runs", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { runs: automatic ? [automatic] : [] } });
    const body = route.request().postDataJSON();
    if (body.action === "start") {
      expect(body.connection.imagesEnabled).toBe(true);
      expect(body.imageModel).toBe("cx/gpt-image-2.5-sunburst");
      expect(version.mappings.actor).toBe(character.id);
      expect(version.audioMode).toBe("ORIGINAL");
      expect(version.visualDirection?.expression).toBe("EXPRESSIVE");
      automatic = {
        id: randomUUID(),
        projectId: project.id,
        versionId: version.id,
        fingerprint: "current",
        state: "RUNNING",
        stage: "AUDIO",
        cursor: 0,
        jobs: {},
        reservations: {},
        maxCredits: body.maxCredits,
        imageModel: body.imageModel,
        message: "Preparing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (body.action === "advance") {
      advances++;
      automatic!.updatedAt = new Date().toISOString();
      automatic!.stage =
        advances === 1 ? "FRAMES" : advances === 2 ? "FLOW" : "ASSEMBLE";
      if (advances === 4) {
        automatic!.state = "COMPLETE";
        automatic!.asset = output;
        version.exportAsset = output;
        automatic!.message =
          "Your final video is assembled and ready to download";
      }
    }
    await route.fulfill({ json: { run: automatic } });
  });
  await page.route("**/api/assets/**", async (route) => {
    await route.fulfill({
      body: await readFile(fixture),
      contentType: "video/mp4",
    });
  });
  await page.goto("/");
  await page.locator(".upload-zone input").setInputFiles(fixture);
  await expect(
    page.getByRole("region", { name: "Guided reenactment" }),
  ).toBeVisible();
  await page.getByLabel("Replace Actor 1 with").selectOption(character.id);
  await page
    .getByRole("button", { name: "Continue to audio", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Skip optional steps · use defaults",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Generate and assemble automatically.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to audio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue to background", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Background", exact: true })
    .selectOption("NEW");
  await page
    .getByRole("button", { name: "Skip remaining options", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Generate final MP4 · up to/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Download final MP4", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  expect(advances).toBe(4);
  await expect(page.locator(".final-preview")).toHaveAttribute(
    "src",
    `/api/assets/${output}`,
  );
});

test("Flow workspace prepares and reviews a quote before one submission, then imports the result", async ({
  page,
}) => {
  const version = newVersion(randomUUID());
  version.target = "OMNI_FLASH";
  version.planRevision = 1;
  version.segments = [
    {
      id: "segment",
      shotId: "shot",
      start: 0,
      end: 4,
      duration: 4,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 7,
      warnings: [],
    },
  ];
  const first = `${randomUUID()}.png`,
    last = `${randomUUID()}.png`,
    clip = `${randomUUID()}.mp4`;
  version.frames.segment = {
    first,
    last,
    generated: { first, last, signature: "references" },
  };
  const project = {
    id: randomUUID(),
    name: "Bridge test",
    analysisId: "analysis",
    versions: [version],
    updatedAt: "now",
  };
  const snapshot = {
    projects: [project],
    analyses: [
      {
        id: "analysis",
        sourceAsset: clip,
        sourceName: "test.mp4",
        sourceHash: "source",
        media: {
          duration: 4,
          width: 360,
          height: 640,
          fps: 24,
          hasAudio: true,
        },
        shots: [
          {
            id: "shot",
            start: 0,
            end: 4,
            description: "A test performance",
            motion: "Wave once",
            camera: "Fixed",
            lighting: "Even",
          },
        ],
        speakers: [],
        turns: [],
        activity: [],
        status: "ANALYZED",
        revision: 1,
        warnings: [],
        createdAt: "now",
      },
    ],
    characters: [],
    ffmpegReady: true,
  };
  let job: FlowJob | undefined,
    submissions = 0;
  await page.route("**/api/studio", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/studio/flow*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          jobs: job ? [job] : [],
          connection: {
            connected: true,
            signedIn: true,
            message: "Test Flow connection",
          },
        },
      });
    const body = route.request().postDataJSON();
    if (body.action === "prepare")
      job = {
        id: randomUUID(),
        state: "PREPARED",
        createdAt: "now",
        updatedAt: "now",
        fingerprint: "input",
        quote: 4,
        draftSignature: "draft",
        projectUrl:
          "https://flow.google.com/project/11111111-1111-1111-1111-111111111111",
        binding: {
          projectId: project.id,
          versionId: version.id,
          segmentId: "segment",
          signature: "current",
        },
        input: {
          prompt: "Preserve the performance",
          model: "OMNI_FLASH",
          mode: "FIRST_LAST",
          duration: 4,
          aspect: "16:9",
          first,
          last,
          references: [],
          settings: body.settings,
        },
      };
    if (body.action === "submit") {
      expect(body.maxCredits).toBe(4);
      submissions++;
      job!.state = "RUNNING";
    }
    if (body.action === "refresh") job!.state = "COMPLETE";
    if (body.action === "download") job!.asset = clip;
    if (body.action === "import")
      version.clips.segment = {
        asset: clip,
        trim: 0,
        media: {
          duration: 4,
          width: 360,
          height: 640,
          fps: 24,
          hasAudio: true,
        },
      };
    await route.fulfill({ json: { job } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Flow workspace/ }).click();
  const bridge = page.getByRole("region", { name: "Local Flow bridge" });
  await expect(
    bridge.getByRole("button", { name: /Generate one clip/ }),
  ).toHaveCount(0);
  await bridge
    .getByRole("button", { name: /Prepare selected segment/ })
    .click();
  const generate = bridge.getByRole("button", {
    name: "Generate one clip · 4 credits",
    exact: true,
  });
  await expect(generate).toBeVisible();
  expect(submissions).toBe(0);
  await generate.click();
  await expect(generate).toHaveCount(0);
  expect(submissions).toBe(1);
  await bridge
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await bridge
    .getByRole("button", { name: "Download original result", exact: true })
    .click();
  await bridge
    .getByRole("button", { name: "Use original in this segment", exact: true })
    .click();
  await expect.poll(() => version.clips.segment?.asset).toBe(clip);
  expect(submissions).toBe(1);
});

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
  await expect(
    page.getByLabel("Appearance notes for Actor 1", { exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Replace Actor 1 with").selectOption(characterId!);
  await page
    .getByLabel("Appearance notes for Actor 1", { exact: true })
    .fill("Wear glasses and have diamonds on the teeth.");
  await page
    .getByRole("button", { name: "Save cast & appearance", exact: true })
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
  await expect(segments.nth(0).locator(".source-frame-pair img")).toHaveCount(
    2,
  );
  await expect(
    segments.nth(0).locator(".replacement-frame-pair img"),
  ).toHaveCount(0);
  await expect(
    segments.nth(0).locator(".replacement-frame-pair"),
  ).toContainText("NOT GENERATED");
  await expect(
    page.getByText("0/2 segments have generated replacement frame pairs.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/Browser test performer/);
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/Wear glasses and have diamonds on the teeth/);
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
  const firstExport = await video.getAttribute("src");
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  const firstSegment = segments.nth(0);
  const firstClip = await firstSegment
    .locator(".imported-preview video")
    .getAttribute("src");
  await expect(firstSegment.locator(".imported-preview")).toContainText(
    "Only 2.00s",
  );
  const shortReplacement = path.resolve(".tmp/e2e-short-replacement.mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    shortReplacement,
  ]);
  await page
    .getByLabel("Upload clip for segment 1", { exact: true })
    .setInputFiles({
      name: "replacement-take.mp4",
      mimeType: "video/mp4",
      buffer: await readFile(shortReplacement),
    });
  await expect(
    firstSegment.locator(".imported-preview video"),
  ).not.toHaveAttribute("src", firstClip!);
  await expect(firstSegment.locator(".imported-preview")).toContainText(
    "Assigned file: replacement-take.mp4",
  );
  await expect(firstSegment.locator(".imported-preview")).toContainText(
    "Export uses 0.00s–1.00s",
  );
  await expect(firstSegment.locator(".imported-preview")).toContainText(
    "hold for 1.00s",
  );
  await page
    .getByRole("button", { name: /Assemble & export Make the final cut/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Download MP4", exact: true }),
  ).toHaveCount(0);
  await page.getByText("Clips used in this export", { exact: true }).click();
  await expect(page.getByText(/replacement-take.mp4 · use/)).toBeVisible();
  await page
    .getByLabel("Assembly timing", { exact: true })
    .selectOption("EDITED_CLIPS");
  await expect(page.getByText(/e2e-fixture.mp4 · use/)).toContainText(
    "0.00s–3.00s",
  );
  await page
    .getByRole("button", { name: "Assemble final MP4", exact: true })
    .click();
  await expect(video).toBeVisible({ timeout: 45000 });
  await expect(video).not.toHaveAttribute("src", firstExport!);
  await page.reload();
  await page
    .getByRole("button", { name: /Assemble & export Make the final cut/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Download MP4", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Assembly timing", { exact: true })).toHaveValue(
    "EDITED_CLIPS",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".tmp/studio-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  // A new look reuses the plan and source evidence, while requiring new clips.
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  await expect(page.getByLabel("Character expressiveness")).toHaveValue(
    "SUBTLE",
  );
  await expect(
    page.getByLabel("Complete cropped or padded areas"),
  ).toBeChecked();
  await page.getByLabel("Complete cropped or padded areas").uncheck();
  await page
    .getByRole("combobox", { name: "Background", exact: true })
    .selectOption("NEW");
  await expect(
    page.getByRole("button", { name: "Save scene & expression", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("New background description")
    .fill("A pastel dance studio with warm daylight");
  await page.getByLabel("Character expressiveness").selectOption("EXPRESSIVE");
  await page
    .getByRole("button", { name: "Save scene & expression", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Version saved", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".segment-card")).toHaveCount(2);
  await expect(
    page
      .locator(".clip-import")
      .getByText("Generated clip ready", { exact: true }),
  ).toHaveCount(0);
  await expect(segments.nth(0).locator(".source-frame-pair img")).toHaveCount(
    2,
  );
  await expect(
    segments.nth(0).locator(".replacement-frame-pair img"),
  ).toHaveCount(0);
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/A pastel dance studio with warm daylight/);
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/EXPRESSION — MORE EXPRESSIVE/);
  await expect(
    segments.nth(0).getByLabel("Flow prompt for segment 1"),
  ).toHaveValue(/Browser test performer/);
  await page.reload();
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Background", exact: true }),
  ).toHaveValue("NEW");
  await expect(page.getByLabel("New background description")).toHaveValue(
    "A pastel dance studio with warm daylight",
  );
  await expect(page.getByLabel("Character expressiveness")).toHaveValue(
    "EXPRESSIVE",
  );
  await expect(
    page.getByLabel("Complete cropped or padded areas"),
  ).not.toBeChecked();
  await expect(page.getByLabel("Flow prompt for segment 1")).toHaveValue(
    /Wear glasses and have diamonds on the teeth/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Flow separates original source images from generated replacement images for every segment", async ({
  page,
}) => {
  const asset = () => `${randomUUID()}.png`;
  const originalFirst = asset(),
    originalBoundary = asset(),
    originalLast = asset();
  const generatedFirst = asset(),
    generatedLast = asset();
  const version = newVersion("display-version");
  version.planRevision = 1;
  version.mappings.actor = "replacement";
  version.segments = [
    {
      id: "first",
      shotId: "shot",
      start: 0,
      end: 4,
      duration: 4,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 10,
      warnings: [],
    },
    {
      id: "second",
      shotId: "shot",
      start: 4,
      end: 8,
      duration: 4,
      overlap: 0,
      strategy: "FIRST_LAST",
      credits: 10,
      warnings: [],
    },
  ];
  version.frames.first = { first: originalFirst, last: originalBoundary };
  version.frames.second = {
    first: originalBoundary,
    last: originalLast,
    generated: {
      first: generatedFirst,
      last: generatedLast,
      signature: "generated",
    },
  };
  await page.route("**/api/studio", (route) =>
    route.fulfill({
      json: {
        ffmpegReady: true,
        projects: [
          {
            id: "display-project",
            name: "Frame display",
            analysisId: "display-analysis",
            versions: [version],
            updatedAt: "now",
          },
        ],
        analyses: [
          {
            id: "display-analysis",
            sourceAsset: `${randomUUID()}.mp4`,
            sourceName: "reference.mp4",
            sourceHash: "source",
            media: {
              duration: 8,
              width: 320,
              height: 180,
              fps: 30,
              hasAudio: false,
            },
            shots: [
              {
                id: "shot",
                start: 0,
                end: 8,
                description: "Original performer",
                camera: "Static",
                lighting: "Even",
                motion: "",
              },
            ],
            speakers: [
              { id: "actor", name: "Original actor", description: "At center" },
            ],
            turns: [],
            activity: [],
            status: "ANALYZED",
            revision: 1,
            createdAt: "now",
            warnings: [],
          },
        ],
        characters: [
          {
            id: "replacement",
            name: "Saved replacement",
            description: "User's chosen character",
            visualStyle: "Illustrated",
            references: [],
            voice: defaultVoice(),
            updatedAt: "now",
          },
        ],
      },
    }),
  );
  await page.route("**/api/assets/**", (route) =>
    route.request().url().endsWith(".png")
      ? route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
            "base64",
          ),
        })
      : route.fulfill({ status: 404 }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: /Flow workspace Generate shot by shot/ })
    .click();
  const segments = page.locator(".segment-card");
  await expect(
    page.getByText("1/2 segments have generated replacement frame pairs.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    segments.nth(0).locator(".replacement-frame-pair img"),
  ).toHaveCount(0);
  await expect(
    segments.nth(0).locator(".replacement-frame-pair"),
  ).toContainText("NOT GENERATED");
  await expect(segments.nth(0).locator(".source-frame-pair img")).toHaveCount(
    2,
  );
  await expect(
    segments.nth(1).locator(".replacement-frame-pair img"),
  ).toHaveCount(2);
  await expect(
    segments.nth(1).locator(".replacement-frame-pair img").first(),
  ).toHaveAttribute("src", `/api/assets/${generatedFirst}`);
  await expect(
    segments.nth(1).locator(".source-frame-pair img").first(),
  ).toHaveAttribute("src", `/api/assets/${originalBoundary}`);
  await expect(
    page.getByRole("link", {
      name: "Download generated replacement first frame for segment 2",
      exact: true,
    }),
  ).toBeVisible();
  await segments
    .nth(1)
    .getByText("Source frame references · original cast", { exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Download original source first frame for segment 2",
      exact: true,
    }),
  ).toBeVisible();
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
  const analysisPrompts: string[] = [];
  const router = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const content = JSON.parse(Buffer.concat(chunks).toString()).messages[0]
      .content;
    const prompt = content[0].text as string;
    analysisPrompts.push(prompt);
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
    const description = page.getByLabel(/What.s happening in this video/);
    await description.fill(
      "A tabletop object changes position during this visual meme.",
    );
    await page
      .getByRole("button", { name: "Save source description", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Save source description",
        exact: true,
      }),
    ).toBeDisabled();
    expect(analysisPrompts).toHaveLength(0);
    await page.reload();
    await expect(description).toHaveValue(
      "A tabletop object changes position during this visual meme.",
    );
    await page
      .getByRole("button", { name: "Analyze with OpenAI", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refine motion timing", exact: true }),
    ).toBeVisible({ timeout: 45000 });
    expect(analysisPrompts.length).toBeGreaterThan(0);
    expect(
      analysisPrompts.every((prompt) =>
        prompt.includes(
          "A tabletop object changes position during this visual meme.",
        ),
      ),
    ).toBe(true);
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
    await description.fill(
      "The object moves briefly, then stays in its new position.",
    );
    await page
      .getByRole("button", {
        name: "Update analysis with description",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Analysis saved for reuse",
        exact: true,
      }),
    ).toBeVisible({ timeout: 45000 });
    expect(analysisPrompts.at(-1)).toContain(
      "The object moves briefly, then stays in its new position.",
    );
    await page
      .getByText("Edit shot boundaries, motion and camera", { exact: true })
      .click();
    await expect(
      page.getByLabel("Motion action 1", { exact: true }),
    ).toHaveValue("Human verified object movement");
  } finally {
    router.closeAllConnections();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  }
});
