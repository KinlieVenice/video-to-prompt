import { z } from "zod";
import { localRequest } from "../../../lib/studio/server/http";
import {
  assetPath,
  exclusive,
  getRecord,
  listRecords,
  saveRecord,
  writeAsset,
} from "../../../lib/studio/server/store";
import { resolveRouterConnection } from "../../../lib/studio/server/connection";
import {
  guidedDefaults,
  nicheDefaults,
} from "../../../lib/studio/server/guidedDefaults";
import { connectionSchema } from "../../../lib/studio/connection";
import { NicheService } from "../../../lib/studio/services/NicheService";
import { VideoAnalysisService } from "../../../lib/studio/services/VideoAnalysisService";
import { StudioRunService } from "../../../lib/studio/services/StudioRunService";
import { probe } from "../../../lib/studio/server/ffmpeg";
import type { Analysis } from "../../../lib/studio/types";
import type { Niche, NicheVideo } from "../../../lib/studio/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const schema = z.object({
  action: z.enum([
    "save",
    "upload_reference",
    "analyze_reference",
    "upload_audio",
    "create_video",
    "start_video",
    "save_plan",
  ]),
  value: z.unknown().optional(),
  nicheId: id.optional(),
  analysisId: id.optional(),
  requestId: z.string().uuid().optional(),
  videoId: id.optional(),
  topic: z.string().trim().min(1).max(2000).optional(),
  connection: connectionSchema.optional(),
});
const service = new NicheService();
const runner = new StudioRunService();
function fail(error: unknown) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Niche operation failed.",
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: Request) {
  try {
    localRequest(request);
    const niches = await NicheService.list();
    const references = new Set(niches.flatMap((n) => n.referenceIds));
    return Response.json(
      {
        niches,
        videos: await NicheService.videos(),
        references: (await listRecords<Analysis>("analyses")).filter((a) =>
          references.has(a.id),
        ),
        defaults: guidedDefaults(),
        nicheDefaults: nicheDefaults(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    localRequest(request);
    if (Number(request.headers.get("content-length") || 0) > 513 * 1024 * 1024)
      throw new Error("Upload limit is 512 MB.");
    const form = await request.formData();
    const p = schema.parse(JSON.parse(String(form.get("payload") || "{}")));
    const connection = resolveRouterConnection(p.connection);
    return await exclusive(async () => {
      const upload = async (extensions: string[], max = 512 * 1024 * 1024) => {
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > max)
          throw new Error("Choose a nonempty file within the upload limit.");
        const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
        if (!extensions.includes(extension))
          throw new Error(`Choose ${extensions.join(" / ")}.`);
        return {
          asset: await writeAsset(
            Buffer.from(await file.arrayBuffer()),
            extension,
          ),
          name: file.name,
        };
      };
      if (p.action === "save")
        return Response.json({ niche: await NicheService.save(p.value) });
      if (p.action === "save_plan") {
        if (!p.videoId) throw new Error("Choose a planned topic video.");
        return Response.json({
          video: await service.savePlan(p.videoId, p.value),
        });
      }
      if (p.action === "create_video" || p.action === "start_video") {
        let video: NicheVideo;
        if (p.action === "create_video") {
          if (!p.nicheId || !p.topic || !p.requestId)
            throw new Error("Choose a niche and enter a topic.");
          video = await service.create(
            p.nicheId,
            p.topic,
            p.requestId,
            connection,
          );
        } else {
          if (!p.videoId) throw new Error("Choose a planned topic video.");
          video = await getRecord<NicheVideo>("niche-videos", p.videoId);
        }
        if (!video.projectId || !video.versionId)
          throw new Error("Finish planning this topic first.");
        if (
          p.action === "create_video" &&
          video.nicheSnapshot.storytelling?.reviewBeforeGeneration &&
          !video.runId
        )
          return Response.json({ video });
        const run = video.runId
          ? await StudioRunService.get(video.runId)
          : await runner.start(
              video.projectId,
              video.versionId,
              video.nicheSnapshot.maxCredits,
              {
                ...connection,
                imagesEnabled: true,
                ttsEnabled:
                  video.nicheSnapshot.audioMode === "CHARACTER_TTS" ||
                  connection.ttsEnabled,
              },
              video.nicheSnapshot.defaults.imageModel,
            );
        video.runId = run.id;
        video.updatedAt = new Date().toISOString();
        await saveRecord("niche-videos", video);
        return Response.json({ video, run });
      }
      if (!p.nicheId) throw new Error("Save a niche first.");
      const niche = await getRecord<Niche>("niches", p.nicheId);
      if (p.action === "upload_audio") {
        const uploaded = await upload(
          ["wav", "mp3", "m4a", "flac", "ogg"],
          100 * 1024 * 1024,
        );
        if (!(await probe(assetPath(uploaded.asset))).hasAudio)
          throw new Error("This recording has no audio track.");
        niche.uploadedAudio = uploaded.asset;
        niche.updatedAt = new Date().toISOString();
        await NicheService.save(niche);
      } else if (p.action === "upload_reference") {
        if (niche.referenceIds.length >= 6)
          throw new Error("Maximum six reference videos per niche.");
        const uploaded = await upload(["mp4", "mov"]);
        const inspected = await VideoAnalysisService.inspect(
          uploaded.asset,
          uploaded.name,
        );
        niche.referenceIds = [
          ...new Set([...niche.referenceIds, inspected.id]),
        ];
        niche.updatedAt = new Date().toISOString();
        await NicheService.save(niche);
        await VideoAnalysisService.analyze(inspected, connection);
      } else {
        if (!p.analysisId || !niche.referenceIds.includes(p.analysisId))
          throw new Error("Choose a reference belonging to this niche.");
        await VideoAnalysisService.analyze(
          await getRecord<Analysis>("analyses", p.analysisId),
          connection,
        );
      }
      return Response.json({
        niche: await getRecord<Niche>("niches", niche.id),
      });
    });
  } catch (error) {
    return fail(error);
  }
}
