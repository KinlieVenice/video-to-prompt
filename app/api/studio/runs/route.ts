import { z } from "zod";
import { localRequest } from "../../../lib/studio/server/http";
import { exclusive } from "../../../lib/studio/server/store";
import { connectionSchema } from "../../../lib/studio/connection";
import { resolveRouterConnection } from "../../../lib/studio/server/connection";
import { StudioRunService } from "../../../lib/studio/services/StudioRunService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const schema = z.object({
  action: z.enum(["start", "advance", "pause", "resume"]),
  projectId: id.optional(),
  versionId: id.optional(),
  runId: id.optional(),
  maxCredits: z.number().finite().min(0).max(10000).optional(),
  imageModel: z.string().trim().min(1).max(200).optional(),
  connection: connectionSchema.optional(),
});
const service = new StudioRunService();
function fail(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Run failed." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: Request) {
  try {
    localRequest(request);
    return Response.json(
      { runs: await StudioRunService.list() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    localRequest(request);
    const raw = await request.text();
    if (raw.length > 20000) throw new Error("Run request is too large.");
    const p = schema.parse(JSON.parse(raw));
    return await exclusive(async () => {
      let run;
      if (p.action === "start") {
        if (!p.projectId || !p.versionId || p.maxCredits === undefined)
          throw new Error("Choose a project, version and Flow credit limit.");
        run = await service.start(
          p.projectId,
          p.versionId,
          p.maxCredits,
          resolveRouterConnection(p.connection),
          p.imageModel,
        );
      } else {
        if (!p.runId) throw new Error("Select a run.");
        run =
          p.action === "advance"
            ? await service.advance(
                p.runId,
                resolveRouterConnection(p.connection),
              )
            : p.action === "resume"
              ? await service.resume(p.runId, p.maxCredits)
              : await service.pause(p.runId);
      }
      return Response.json(
        { run },
        { headers: { "Cache-Control": "no-store" } },
      );
    });
  } catch (error) {
    return fail(error);
  }
}
