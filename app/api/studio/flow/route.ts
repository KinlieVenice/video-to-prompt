import {
  flowContext,
  currentFlowContext,
} from "../../../lib/studio/services/FlowContextService";
import { z } from "zod";
import { localRequest } from "../../../lib/studio/server/http";
import {
  exclusive,
  getRecord,
  saveRecord,
  listRecords,
  assetPath,
} from "../../../lib/studio/server/store";
import { FlowBrowserService } from "../../../lib/studio/services/FlowBrowserService";
import { FlowJobService } from "../../../lib/studio/services/FlowJobService";
import {
  flowInputSchema,
  flowSettingsSchema,
  type FlowJob,
  type FlowSettings,
} from "../../../lib/studio/flow";
import { probe } from "../../../lib/studio/server/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const browser = new FlowBrowserService();
const service = new FlowJobService(browser);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const requestSchema = z.object({
  action: z.enum([
    "prepare",
    "submit",
    "refresh",
    "download",
    "upscale",
    "dismiss",
    "import",
  ]),
  jobId: id.optional(),
  projectId: id.optional(),
  versionId: id.optional(),
  segmentId: id.optional(),
  settings: flowSettingsSchema.optional(),
  input: z.unknown().optional(),
  maxCredits: z.number().finite().min(0).max(10000).optional(),
  upscaled: z.boolean().default(false),
  newAttempt: z.boolean().default(false),
});
function fail(error: unknown) {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((i) => i.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Flow bridge failed.";
  return Response.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
const context = (
  projectId: string,
  versionId: string,
  segmentId: string,
  settings?: FlowSettings,
) => flowContext(browser, projectId, versionId, segmentId, settings);
const current = (job: FlowJob) => currentFlowContext(browser, job);
export async function GET(request: Request) {
  try {
    localRequest(request);
    return await exclusive(async () =>
      Response.json(
        {
          connection: new URL(request.url).searchParams.has("jobsOnly")
            ? undefined
            : await browser.status(),
          jobs: await FlowJobService.list(),
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    localRequest(request);
    if (Number(request.headers.get("content-length") || 0) > 100000)
      throw new Error("Flow request is too large.");
    const raw = await request.text();
    if (raw.length > 100000) throw new Error("Flow request is too large.");
    const p = requestSchema.parse(JSON.parse(raw));
    return await exclusive(async () => {
      let job: FlowJob;
      if (p.action === "prepare") {
        if (p.projectId && p.versionId && p.segmentId) {
          const ctx = await context(
            p.projectId,
            p.versionId,
            p.segmentId,
            p.settings,
          );
          job = await service.prepare(ctx.input, ctx.binding, p.newAttempt);
        } else {
          const input = flowInputSchema.parse(p.input);
          if (!input.settings.projectUrl) {
            const connected = await browser.status();
            if (!connected.projectUrl) throw new Error(connected.message);
            input.settings.projectUrl = connected.projectUrl;
          }
          job = await service.prepare(input, undefined, p.newAttempt);
        }
      } else {
        if (!p.jobId) throw new Error("Select a Flow job.");
        const saved = await FlowJobService.get(p.jobId);
        switch (p.action) {
          case "submit":
            await current(saved);
            if (p.maxCredits === undefined)
              throw new Error(
                "Supply the maximum credits approved for this job.",
              );
            job = await service.submit(p.jobId, p.maxCredits);
            break;
          case "refresh":
            job = await service.refresh(p.jobId);
            break;
          case "download":
            job = await service.download(p.jobId, p.upscaled);
            break;
          case "upscale":
            job = await service.upscale(p.jobId);
            break;
          case "dismiss":
            job = await service.dismiss(p.jobId);
            break;
          case "import": {
            const ctx = await current(saved);
            if (!ctx)
              throw new Error(
                "This standalone job is not bound to a Recast segment.",
              );
            const output = p.upscaled ? saved.upscale : saved;
            if (!output?.asset || output.state !== "COMPLETE")
              throw new Error(
                "Download the completed result before importing.",
              );
            const media = await probe(assetPath(output.asset));
            if (!media.width || media.duration <= ctx.segment.overlap + 0.001)
              throw new Error("Flow clip has no usable video after overlap.");
            ctx.version.clips[ctx.segment.id] = {
              asset: output.asset,
              media,
              trim: 0,
              sourceName: `Flow ${saved.id}${p.upscaled ? " · 720p" : ""}`,
              importedAt: new Date().toISOString(),
            };
            ctx.version.exportAsset = undefined;
            ctx.version.exportSignature = undefined;
            await saveRecord("projects", ctx.project);
            job = saved;
            break;
          }
        }
      }
      return Response.json(
        { job },
        { headers: { "Cache-Control": "no-store" } },
      );
    });
  } catch (error) {
    return fail(error);
  }
}
