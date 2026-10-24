import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../../app/lib/studio/server/ffmpeg";
import { defaultVoice, type Analysis } from "../../app/lib/studio/types";
import {
  guidedDefaultsSchema,
  type StudioRun,
} from "../../app/lib/studio/guided";
import {
  nicheSchema,
  type Niche,
  type NicheVideo,
} from "../../app/lib/studio/niche";

test("niche library saves art style and analyzed references, then only a topic produces the final video", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("studio:workflow", "ADVANCED"),
  );
  const fixture = path.resolve(".tmp/niche-browser.mp4");
  await mkdir(path.dirname(fixture), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    fixture,
  ]);
  const output = `${randomUUID()}.mp4`;
  const character = {
    id: randomUUID(),
    name: "Saved presenter",
    description: "A reusable user character",
    visualStyle: "3D",
    references: [],
    voice: defaultVoice(),
    updatedAt: new Date().toISOString(),
  };
  let niches: Niche[] = [],
    videos: NicheVideo[] = [],
    references: Analysis[] = [],
    automatic: StudioRun | undefined,
    uploads = 0,
    advances = 0,
    creates = 0;
  await page.route("**/api/studio", (route) =>
    route.fulfill({
      json: {
        projects: [],
        analyses: [],
        characters: [character],
        ffmpegReady: true,
      },
    }),
  );
  await page.route("**/api/studio/niches", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          niches,
          videos,
          references,
          defaults: guidedDefaultsSchema.parse({}),
        },
      });
    const raw = route.request().postData() || "";
    const body = JSON.parse(
      raw.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] || "{}",
    );
    if (body.action === "save") {
      const saved = nicheSchema.parse(body.value);
      niches = [saved];
      return route.fulfill({ json: { niche: saved } });
    }
    if (body.action === "upload_reference") {
      uploads++;
      references = [
        {
          id: "reference",
          sourceAsset: output,
          sourceName: "reference.mp4",
          sourceHash: "reference",
          status: "ANALYZED",
          revision: 1,
          createdAt: new Date().toISOString(),
          media: {
            duration: 10,
            width: 160,
            height: 90,
            fps: 30,
            hasAudio: false,
          },
          shots: [
            {
              id: "shot",
              start: 0,
              end: 10,
              description: "A clear hook and reveal",
              camera: "Close-up",
              lighting: "Soft",
              motion: "Reveal the prop",
            },
          ],
          speakers: [],
          turns: [],
          activity: [],
          warnings: [],
        },
      ];
      niches[0].referenceIds = ["reference"];
      return route.fulfill({ json: { niche: niches[0] } });
    }
    if (body.action === "create_video") {
      creates++;
      expect(body.topic).toBe("Why the moon changes shape");
      expect(body.requestId).toBeTruthy();
      expect(niches[0].artStyle).toBe("Watercolor storybook");
      expect(niches[0].referenceIds).toEqual(["reference"]);
      expect(niches[0].duration).toBe(10);
      expect(niches[0].characterId).toBe(character.id);
      const now = new Date().toISOString();
      automatic = {
        id: randomUUID(),
        projectId: "topic-project",
        versionId: "topic-version",
        fingerprint: "saved",
        state: "RUNNING",
        stage: "AUDIO",
        cursor: 0,
        jobs: {},
        reservations: {},
        maxCredits: 16,
        imageModel: niches[0].defaults.imageModel,
        message: "Preparing saved audio",
        createdAt: now,
        updatedAt: now,
      };
      const video: NicheVideo = {
        id: body.requestId,
        nicheId: niches[0].id,
        topic: body.topic,
        nicheSnapshot: structuredClone(niches[0]),
        state: "READY",
        referenceRevisions: [{ id: "reference", revision: 1 }],
        projectId: automatic.projectId,
        versionId: automatic.versionId,
        runId: automatic.id,
        createdAt: now,
        updatedAt: now,
        plan: {
          artStyle: niches[0].artStyle,
          title: "Moon phases",
          hook: "Watch the moon",
          summary: "An original scene",
          scenes: [
            {
              description: "The presenter holds a moon model",
              firstFrame: "Holding a sphere",
              lastFrame: "Pointing to the lit side",
              camera: "Close-up",
              lighting: "Soft",
              motion: "Turn the model",
              narration: "",
              emotion: "curious",
            },
          ],
        },
      };
      videos = [video];
      return route.fulfill({ json: { video, run: automatic } });
    }
    await route.fulfill({
      status: 400,
      json: { error: "Unexpected niche action" },
    });
  });
  await page.route("**/api/studio/runs", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { runs: automatic ? [automatic] : [] } });
    const body = route.request().postDataJSON();
    expect(body.action).toBe("advance");
    advances++;
    automatic!.updatedAt = new Date().toISOString();
    automatic!.stage =
      advances === 1 ? "FRAMES" : advances === 2 ? "FLOW" : "ASSEMBLE";
    if (advances === 4) {
      automatic!.state = "COMPLETE";
      automatic!.asset = output;
      automatic!.message =
        "Your final video is assembled and ready to download";
    }
    await route.fulfill({ json: { run: automatic } });
  });
  await page.route("**/api/assets/**", async (route) =>
    route.fulfill({ body: await readFile(fixture), contentType: "video/mp4" }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: /Niche generator Topic to final video/ })
    .click();
  await page.getByRole("button", { name: "Create niche", exact: true }).click();
  await page
    .getByLabel("Niche name", { exact: true })
    .fill("Curiosity stories");
  await page
    .getByLabel("Detailed niche description", { exact: true })
    .fill(
      "Open with a curious question, demonstrate one idea, and end with a playful reveal.",
    );
  await page
    .getByLabel("Art style", { exact: true })
    .fill("Watercolor storybook");
  await page
    .getByLabel("Whole video length (seconds)", { exact: true })
    .fill("10");
  await page
    .getByLabel("Character to use", { exact: true })
    .selectOption(character.id);
  await page.getByLabel("Niche audio", { exact: true }).selectOption("SILENT");
  await page
    .getByLabel("Total Flow credit limit per video", { exact: true })
    .fill("16");
  await page.getByRole("button", { name: "Save niche", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create video", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Upload niche reference video", { exact: true })
    .setInputFiles(fixture);
  await expect(
    page.getByText("Analysis saved for reuse", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: /Niche generator Topic to final video/ })
    .click();
  await expect(
    page.getByText("Art style: Watercolor storybook", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Analysis saved for reuse", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Topic", { exact: true })
    .fill("Why the moon changes shape");
  await page
    .getByRole("button", {
      name: "Create video · up to 16 Flow credits",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause generation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Download niche video", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  expect(creates).toBe(1);
  expect(uploads).toBe(1);
  expect(advances).toBe(4);
  await expect(page.locator(".final-preview")).toHaveAttribute(
    "src",
    `/api/assets/${output}`,
  );
});
