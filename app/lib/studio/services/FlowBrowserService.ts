import {
  chromium,
  errors,
  type Page,
  type Response as BrowserResponse,
} from "playwright-core";
import { readFile } from "node:fs/promises";
import type { FlowDriver } from "./FlowJobService";
import {
  type FlowInput,
  type FlowJob,
  flowCdpEndpoint,
  flowProjectUrl,
  creditQuote,
  rpcPayload,
  findMedia,
  findUpscale,
  acceptedMedia,
  freeUpscalePrice,
  mediaState,
} from "../flow";
import { assetPath, signature, writeAsset } from "../server/store";
import { probe } from "../server/ffmpeg";

function rpc(response: BrowserResponse) {
  const url = new URL(response.url());
  return url.origin === "https://flow.google.com" &&
    url.pathname.endsWith("/data/batchexecute")
    ? url.searchParams.get("rpcids")?.split(",") || []
    : [];
}
async function payloads(response: BrowserResponse) {
  const ids = rpc(response);
  if (
    !ids.length ||
    Number(response.headers()["content-length"] || 0) > 4_000_000
  )
    return [];
  const body = await response.text();
  if (body.length > 4_000_000) return [];
  return ids.map((id) => ({ id, value: rpcPayload(body, id) }));
}
async function observe<T>(
  page: Page,
  select: (value: unknown[], id: string) => T | undefined,
  trigger: () => Promise<unknown>,
  timeout = 25000,
): Promise<T> {
  let finish!: (value: T) => void;
  let fail!: (error: Error) => void;
  const waiting = new Promise<T>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  void waiting.catch(() => {});
  const listener = async (response: BrowserResponse) => {
    try {
      for (const item of await payloads(response)) {
        if (!item.value) continue;
        const selected = select(item.value, item.id);
        if (selected !== undefined) finish(selected);
      }
    } catch {
      /* A response may disappear on navigation; never replay it. */
    }
  };
  page.on("response", listener);
  const timer = setTimeout(
    () =>
      fail(
        new Error(
          "Flow did not return a recognizable operation result. Check its browser window.",
        ),
      ),
    timeout,
  );
  try {
    await trigger();
    return await waiting;
  } finally {
    clearTimeout(timer);
    page.off("response", listener);
  }
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function settings(page: Page) {
  if (
    !(await page.getByRole("radio", { name: "Video", exact: true }).isVisible())
  )
    await button(page, "Settings trigger").click();
}
async function snapshot(page: Page) {
  await settings(page);
  for (const name of ["Video", "x1"]) {
    if (
      (await page
        .getByRole("radio", { name, exact: true })
        .getAttribute("aria-checked")) !== "true"
    )
      throw new Error(
        "Flow is not configured for one video output. Nothing was submitted.",
      );
  }
  const prompt = await page
    .getByRole("textbox", { name: "What do you want to create?", exact: true })
    .innerText();
  const selected = await page
    .locator('button[role="radio"][aria-checked="true"]')
    .allTextContents();
  const model = await button(page, "Select model family").innerText();
  const images = await page
    .locator("flow-prompt-box img")
    .evaluateAll((elements) => elements.map((e) => e.getAttribute("src")));
  const voices = await page
    .locator("flow-prompt-box flow-audio-ingredient-chip")
    .allTextContents();
  const quote = creditQuote(
    await page.locator("a.credit-cost-link").innerText(),
  );
  return {
    quote,
    draftSignature: signature({ prompt, selected, model, images, voices }),
  };
}
async function upload(page: Page, asset: string) {
  const data = await readFile(assetPath(asset));
  if (data.length > 20 * 1024 * 1024)
    throw new Error("Flow reference images must be within 20 MB.");
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 15000 });
  await button(page, "Upload media").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(assetPath(asset));
  // Flow may select an upload immediately or show its preview first.
  const add = button(page, "Add to prompt");
  await Promise.race([
    add.waitFor({ state: "visible", timeout: 20000 }).catch(() => {}),
    page
      .getByRole("button", { name: "Upload media", exact: true })
      .waitFor({ state: "hidden", timeout: 20000 })
      .catch(() => {}),
  ]);
  if (await add.isVisible()) await add.click();
}
export class FlowBrowserService implements FlowDriver {
  private async page<T>(work: (page: Page) => Promise<T>, projectUrl?: string) {
    let browser;
    try {
      browser = await chromium.connectOverCDP(
        flowCdpEndpoint(process.env.FLOW_CDP_ENDPOINT),
        { timeout: 12000 },
      );
    } catch {
      throw new Error(
        "Open the dedicated Flow browser with scripts/flow/start-inspection-browser.ps1 -Visible, then sign in.",
      );
    }
    try {
      const pages = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => {
          try {
            return new URL(page.url()).origin === "https://flow.google.com";
          } catch {
            return false;
          }
        });
      const matching = projectUrl
        ? pages.filter((p) => p.url().startsWith(projectUrl))
        : pages;
      const page =
        matching.length === 1
          ? matching[0]
          : pages.length === 1
            ? pages[0]
            : undefined;
      if (!page)
        throw new Error(
          "Keep one Google Flow tab open in the dedicated browser.",
        );
      page.setDefaultTimeout(15000);
      try {
        return await work(page);
      } catch (error) {
        if (
          error instanceof errors.TimeoutError ||
          (error instanceof Error &&
            /^(locator\.|page\.|Target page, context or browser)/.test(
              error.message,
            ))
        )
          throw new Error(
            "Flow's browser controls were not ready. Check its window for sign-in, upload dialogs or changed controls, then try again.",
          );
        throw error;
      }
    } finally {
      await browser
        .close()
        .catch(
          () => {},
        ); /* Cleanup must not hide an accepted result. CDP disconnect leaves Chrome running. */
    }
  }
  async status(): Promise<{
    connected: boolean;
    signedIn: boolean;
    projectUrl?: string;
    message: string;
  }> {
    try {
      return await this.page(async (page) => {
        const match = page
          .url()
          .match(/^https:\/\/flow\.google\.com\/project\/[a-f0-9-]{36}/);
        return {
          connected: true,
          signedIn: Boolean(match),
          projectUrl: match?.[0],
          message: match
            ? "Signed-in Flow project connected."
            : "Open a Flow project in the dedicated browser.",
        };
      });
    } catch (error) {
      return {
        connected: false,
        signedIn: false,
        message:
          error instanceof Error ? error.message : "Flow browser unavailable.",
      };
    }
  }
  async prepare(input: FlowInput) {
    return this.page(async (page) => {
      const current = page
        .url()
        .match(/^https:\/\/flow\.google\.com\/project\/[a-f0-9-]{36}/)?.[0];
      const projectUrl = flowProjectUrl(
        input.settings.projectUrl || current || "",
      );
      await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
      await button(page, "Settings trigger").waitFor();
      await settings(page);
      await page.getByRole("radio", { name: "Video", exact: true }).click();
      await button(page, "Select model family").click();
      await page
        .getByRole("menuitem", {
          name:
            input.model === "OMNI_FLASH" ? "Omni 1.1 Flash" : "Veo 3.1 - Lite",
          exact: true,
        })
        .click();
      await page
        .getByRole("radio", {
          name: input.mode === "INGREDIENTS" ? "Ingredients" : "Frames",
          exact: true,
        })
        .click();
      await page
        .getByRole("radio", { name: input.aspect, exact: true })
        .click();
      if (input.model === "OMNI_FLASH") {
        await page
          .getByRole("radio", {
            name:
              input.settings.resolution === "360p"
                ? "360p 360p generates faster at lower resolution"
                : "720p",
            exact: true,
          })
          .click();
        await page
          .getByRole("radio", { name: `${input.duration}s`, exact: true })
          .click();
      }
      await page.getByRole("radio", { name: "x1", exact: true }).click();
      await button(page, "Settings trigger").click();
      const attach = async (asset: string, frame?: "Start" | "End") => {
        await button(
          page,
          frame || "Add ingredients to the prompt box",
        ).click();
        await upload(page, asset);
      };
      if (input.mode === "INGREDIENTS") {
        for (const asset of [
          ...new Set(
            [input.first, ...input.references].filter(
              (value): value is string => Boolean(value),
            ),
          ),
        ])
          await attach(asset);
        if (input.settings.voiceName) {
          await button(page, "Add ingredients to the prompt box").click();
          await page.getByRole("tab", { name: "Voices", exact: true }).click();
          const escapedName = input.settings.voiceName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const voice = page
            .getByRole("option", {
              name: new RegExp("^" + escapedName + "(?:\\b|$)", "i"),
            })
            .first();
          try {
            await voice.waitFor({ state: "visible", timeout: 5000 });
          } catch {
            await page
              .getByRole("textbox", { name: "Search assets", exact: true })
              .fill(input.settings.voiceName);
          }
          await voice.click();
          if (input.settings.voiceStyle)
            await page
              .getByRole("textbox", {
                name: "Customize performance",
                exact: true,
              })
              .fill(input.settings.voiceStyle);
          await button(page, "Add to prompt").click();
        }
      } else {
        await attach(input.first!, "Start");
        if (input.mode === "FIRST_LAST") await attach(input.last!, "End");
      }
      await page
        .getByRole("textbox", {
          name: "What do you want to create?",
          exact: true,
        })
        .fill(input.prompt);
      const expectedImages =
        input.mode === "FIRST_LAST"
          ? 2
          : input.mode === "FRAMES"
            ? 1
            : new Set([input.first, ...input.references].filter(Boolean)).size;
      if (expectedImages)
        await page
          .locator("flow-prompt-box img")
          .nth(expectedImages - 1)
          .waitFor({ state: "visible", timeout: 15000 });
      if (!(await button(page, "Start generation").isEnabled()))
        throw new Error(
          "Flow rejected this draft. Review its references, model or voice in the browser. Nothing was submitted.",
        );
      return { projectUrl, ...(await snapshot(page)) };
    }, input.settings.projectUrl || undefined);
  }
  async submit(
    job: FlowJob,
    maxCredits: number,
    beforeClick: () => Promise<void>,
  ) {
    return this.page(async (page) => {
      if (page.url().replace(/\/$/, "") !== job.projectUrl)
        throw new Error(
          "Flow navigated away from the prepared draft. Prepare a fresh draft.",
        );
      const current = await snapshot(page);
      if (current.draftSignature !== job.draftSignature)
        throw new Error(
          "The Flow draft changed. Prepare a fresh draft before submitting.",
        );
      if (current.quote !== job.quote || current.quote > maxCredits)
        throw new Error(
          "Flow's credit quote changed or exceeds the allowed amount. Nothing was submitted.",
        );
      await button(page, "Settings trigger").click();
      if (!(await button(page, "Start generation").isEnabled()))
        throw new Error(
          "Flow is not ready to generate. Check its browser window.",
        );
      return observe(
        page,
        (value, id) => {
          if (!["YhhmEf", "nprQif", "MZZa6b", "eb1hJf"].includes(id)) return;
          return acceptedMedia(value, job.projectUrl);
        },
        async () => {
          await beforeClick();
          await button(page, "Start generation").click({ timeout: 10000 });
        },
      );
    }, job.projectUrl);
  }
  private async openResult(page: Page, job: FlowJob) {
    if (!job.sceneId || !/^[a-f0-9-]{36}$/.test(job.sceneId))
      throw new Error(
        "This Flow result has no recognized scene reference. Open it manually in Flow.",
      );
    await page.goto(`${job.projectUrl}/edit/${job.sceneId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('button[aria-label="Download media"]:not([disabled])')
      .waitFor({ state: "visible", timeout: 20000 });
  }
  async refresh(job: FlowJob, upscaled: boolean) {
    const id = upscaled ? job.upscale?.mediaId : job.mediaId;
    if (!id)
      throw new Error(
        "No accepted Flow media ID is available. Inspect Flow manually.",
      );
    return this.page(
      (page) =>
        observe(
          page,
          (value) => {
            const media = findMedia(value, id);
            if (media) return mediaState((media[5] as unknown[][])[8]?.[0]);
          },
          () => this.openResult(page, job),
        ),
      job.projectUrl,
    );
  }
  async download(job: FlowJob, upscaled: boolean) {
    return this.page(async (page) => {
      await this.openResult(page, job);
      await button(page, "Download media").click();
      const name = upscaled
        ? "720p Upscaled"
        : `${job.input.settings.resolution} Original size`;
      // Flow serves the completed file through this host before its blob download.
      const content = page.waitForResponse(
        (response) =>
          new URL(response.url()).origin === "https://flow-content.google" &&
          response.request().method() === "GET" &&
          /video\/|application\/octet-stream/.test(
            response.headers()["content-type"] || "",
          ),
        { timeout: 30000 },
      );
      void content.catch(() => {});
      await page.getByRole("menuitem", { name, exact: true }).click();
      const response = await content;
      if (
        !response.ok() ||
        Number(response.headers()["content-length"] || 0) > 100 * 1024 * 1024
      )
        throw new Error("Flow download failed or exceeded 100 MB.");
      let bytes = await response.body();
      if (!bytes.length) {
        // Some CDP/cache responses expose an empty body. Reuse the exact result
        // URL just observed in this owned tab, without copying authentication.
        const direct = await fetch(response.url(), {
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }).catch(() => {
          throw new Error(
            "Could not retrieve the completed Flow file. Keep the browser session open and try downloading again.",
          );
        });
        if (
          !direct.ok ||
          !direct.body ||
          Number(direct.headers.get("content-length") || 0) > 100 * 1024 * 1024
        )
          throw new Error(
            "The completed Flow download is unavailable or too large.",
          );
        const reader = direct.body.getReader(),
          chunks: Buffer[] = [];
        let size = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 100 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Flow download exceeded 100 MB.");
          }
          chunks.push(Buffer.from(next.value));
        }
        bytes = Buffer.concat(chunks);
      }
      if (
        bytes.length > 100 * 1024 * 1024 ||
        bytes.subarray(4, 8).toString() !== "ftyp"
      )
        throw new Error(
          "The completed download did not contain an MP4. Retry download or retrieve it manually in Flow.",
        );
      const asset = await writeAsset(bytes, "mp4");
      const media = await probe(assetPath(asset));
      const portrait = job.input.aspect === "9:16";
      const expected =
        upscaled || job.input.settings.resolution === "720p" ? 720 : 360;
      if (
        media.width !== (portrait ? expected : (expected * 16) / 9) ||
        media.height !== (portrait ? (expected * 16) / 9 : expected) ||
        Math.abs(media.duration - job.input.duration) > 0.15
      )
        throw new Error(
          `Downloaded Flow resolution or duration differs from the requested job. Saved ${asset} for review.`,
        );
      return asset;
    }, job.projectUrl);
  }
  async upscale(job: FlowJob, beforeClick: () => Promise<void>) {
    return this.page(async (page) => {
      let existing: unknown[] | undefined;
      let freePrice: boolean | undefined;
      let markPriceReady!: () => void;
      const priceReady = new Promise<void>((resolve) => {
        markPriceReady = resolve;
      });
      const pending: Promise<void>[] = [];
      const inspect = (response: BrowserResponse) => {
        pending.push(
          (async () => {
            try {
              for (const item of await payloads(response)) {
                if (item.id === "HTrJv") {
                  freePrice = freeUpscalePrice(item.value) === true;
                  markPriceReady();
                }
                const candidate = findUpscale(item.value, job.mediaId!);
                if (
                  candidate &&
                  mediaState((candidate[5] as unknown[][])[8]?.[0]) !== "FAILED"
                )
                  existing = candidate;
              }
            } catch {
              /* Metadata may become unavailable during navigation. */
            }
          })(),
        );
      };
      page.on("response", inspect);
      try {
        await this.openResult(page, job);
        await Promise.allSettled(pending);
        if (!existing && freePrice === undefined) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 8000);
            void priceReady.then(() => {
              clearTimeout(timer);
              resolve();
            });
          });
          await Promise.allSettled(pending);
        }
      } finally {
        page.off("response", inspect);
      }
      if (existing) {
        await beforeClick();
        return { mediaId: existing[0] as string };
      }
      if (!freePrice)
        throw new Error(
          "Flow's live model data did not verify a zero-credit upscale. Nothing was submitted.",
        );
      await button(page, "Download media").click();
      const option = page.getByRole("menuitem", {
        name: "720p Upscaled",
        exact: true,
      });
      // Paid entries include a credit suffix. Exact match plus enabled state is
      // essential; never select a differently priced fallback.
      if (!(await option.isEnabled()))
        throw new Error(
          "A free 720p upscale is not currently offered by Flow.",
        );
      return observe(
        page,
        (value, id) => {
          if (id !== "p0UkFb") return;
          const accepted = acceptedMedia(value, job.projectUrl);
          if (accepted && accepted.sceneId === job.sceneId)
            return { mediaId: accepted.mediaId };
        },
        async () => {
          await beforeClick();
          await option.click();
        },
      );
    }, job.projectUrl);
  }
}
