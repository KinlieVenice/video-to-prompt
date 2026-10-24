import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Analysis, Shot } from "../types";
import { assetPath, cacheGet, newAsset, saveRecord } from "../server/store";
import { probe, run } from "../server/ffmpeg";
import type { RouterConnection } from "../connection";
import { OpenAIAnalysisProvider } from "./OpenAIAnalysisProvider";
import { SpeakerDiarizationService } from "./SpeakerDiarizationService";

export class VideoAnalysisService {
  static async inspect(
    sourceAsset: string,
    sourceName: string,
  ): Promise<Analysis> {
    const source = assetPath(sourceAsset);
    const media = await probe(source);
    if (!media.width)
      throw new Error("Upload an MP4 or MOV containing a video stream.");
    if (media.duration > 600)
      throw new Error(
        "The local MVP supports source videos up to 10 minutes. Trim the source first.",
      );
    const sourceHash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
    const cached = await cacheGet<{ analysisId: string }>(
      `source-${sourceHash}`,
    );
    if (cached) {
      const { getRecord } = await import("../server/store");
      return getRecord<Analysis>("analyses", cached.analysisId);
    }
    const scene = await run("ffmpeg", [
      "-hide_banner",
      "-i",
      source,
      "-an",
      "-vf",
      "scale=320:-2,select='gt(scene,0.3)',showinfo",
      "-fps_mode",
      "vfr",
      "-f",
      "null",
      "-",
    ]);
    const cuts = [...scene.stderr.matchAll(/pts_time:([\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((t) => t > 0.025 && t < media.duration - 0.025);
    const boundaries = [0, ...new Set(cuts), media.duration].sort(
      (a, b) => a - b,
    );
    const shots: Shot[] = boundaries.slice(0, -1).map((start, i) => ({
      id: randomUUID(),
      start,
      end: boundaries[i + 1],
      description: "",
      camera: "",
      motion: "",
      lighting: "",
    }));
    let activity: Analysis["activity"] = [];
    if (media.hasAudio) {
      const silence = await run("ffmpeg", [
        "-hide_banner",
        "-i",
        source,
        "-vn",
        "-af",
        "silencedetect=noise=-35dB:d=0.15",
        "-f",
        "null",
        "-",
      ]);
      activity = SpeakerDiarizationService.activity(
        silence.stderr,
        media.duration,
      );
    }
    const analysis: Analysis = {
      id: randomUUID(),
      sourceAsset,
      sourceName,
      sourceHash,
      media,
      shots,
      activity,
      speakers: [],
      turns: [],
      status: "LOCAL",
      revision: 1,
      createdAt: new Date().toISOString(),
      warnings: [
        "Scene cuts are measured with FFmpeg; correct missed cuts or false positives in the timeline.",
        "Audio activity includes music and effects. Speaker identity and transcript timing require review.",
      ],
    };
    await saveRecord("analyses", analysis);
    await saveRecord("cache", {
      id: `source-${sourceHash}`,
      analysisId: analysis.id,
    });
    return analysis;
  }

  static async analyze(
    analysis: Analysis,
    connection: RouterConnection,
    motionOnly = false,
  ): Promise<Analysis> {
    if (analysis.origin === "PLANNED")
      throw new Error(
        "Generated storyboards contain planned scenes, not observed source footage. Create a new topic plan instead of analyzing the timing scaffold.",
      );
    return OpenAIAnalysisProvider.analyze(analysis, connection, motionOnly);
  }
}
