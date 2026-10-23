import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { run } from "../../app/lib/studio/server/ffmpeg";

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
