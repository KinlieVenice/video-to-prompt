import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GoogleGenAI, FileState } from "@google/genai";
import { z } from "zod";
import type { Analysis, Shot, Speaker, Turn } from "../types";
import { ANALYSIS_MODELS } from "../types";
import { speakerSchema } from "../validation";
import { assetPath, cacheGet, newAsset, saveRecord } from "../server/store";
import { probe, run } from "../server/ffmpeg";
import { googleRequest, jsonOutput, type Interaction } from "../server/google";
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
    apiKey: string,
    model: string,
  ): Promise<Analysis> {
    if (!ANALYSIS_MODELS.includes(model))
      throw new Error("Unsupported analysis model.");
    if (analysis.status === "ANALYZED") return analysis;
    if (!apiKey.trim()) throw new Error("Add a Gemini API key in Settings.");
    const speechKey = `speech-${analysis.sourceHash}-${model}-${analysis.revision}`;
    let speech: { speakers: Speaker[]; turns: Turn[] } = {
      speakers: [],
      turns: [],
    };
    if (analysis.media.hasAudio) {
      const cachedSpeech = await cacheGet<typeof speech>(speechKey);
      if (cachedSpeech)
        speech = { speakers: cachedSpeech.speakers, turns: cachedSpeech.turns };
      else {
        const audio = await newAsset("flac");
        await run("ffmpeg", [
          "-y",
          "-i",
          assetPath(analysis.sourceAsset),
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          audio.path,
        ]);
        speech = await SpeakerDiarizationService.transcribe(
          analysis,
          audio.asset,
          apiKey,
          model,
        );
        await saveRecord("cache", { id: speechKey, ...speech });
      }
    }
    const ai = new GoogleGenAI({ apiKey });
    const uploaded = await ai.files.upload({
      file: assetPath(analysis.sourceAsset),
      config: {
        mimeType: analysis.sourceAsset.endsWith(".mov")
          ? "video/quicktime"
          : "video/mp4",
      },
    });
    if (!uploaded.name) throw new Error("Gemini did not return a file ID.");
    try {
      let ready = uploaded;
      const deadline = Date.now() + 300_000;
      while (ready.state !== FileState.ACTIVE) {
        if (ready.state === FileState.FAILED || Date.now() > deadline)
          throw new Error("Gemini source processing failed or timed out.");
        await new Promise((r) => setTimeout(r, 2000));
        ready = await ai.files.get({ name: uploaded.name });
      }
      const visualKey = `visual-${analysis.sourceHash}-${model}-${analysis.revision}`;
      let visual = await cacheGet<{
        shots: {
          id: string;
          description: string;
          camera: string;
          motion: string;
          lighting: string;
        }[];
        speakers: Speaker[];
      }>(visualKey);
      if (!visual) {
        const response = await googleRequest<Interaction>(
          "interactions",
          apiKey,
          {
            model,
            store: false,
            input: [
              { type: "video", uri: ready.uri, mime_type: ready.mimeType },
              {
                type: "text",
                text: `Analyze these exact shots independently: ${JSON.stringify(analysis.shots.map(({ id, start, end }) => ({ id, start, end })))}. Preserve IDs and cuts; never merge shots. Describe actor positions, appearance, emotions, gestures, composition, clothing, background, lighting, camera movement and timestamped motion beats using absolute source seconds. A separate audio pass found ${JSON.stringify(speech)}. Match those anonymous speaker IDs to visible actors only when the video supports it; include visible appearance and position in their descriptions. Keep uncertain/offscreen speakers labeled uncertain/offscreen. Add silent visible actors with unique actor_N IDs. Never infer real identities. Return ONLY JSON {"shots":[{"id":"existing shot ID","description":"...","camera":"...","motion":"0.0s: action; ...","lighting":"..."}],"speakers":[{"id":"existing speaker ID or new actor_N","name":"Actor label","description":"visible appearance/position and voice evidence; note uncertainty"}]}. Preserve the supplied transcript exactly; do not retranscribe or rewrite it. No replacement character settings.`,
              },
            ],
          },
        );
        visual = z
          .object({
            shots: z.array(
              z.object({
                id: z.string(),
                description: z.string(),
                camera: z.string(),
                motion: z.string(),
                lighting: z.string(),
              }),
            ),
            speakers: z.array(speakerSchema),
          })
          .parse(jsonOutput(response));
        if (
          analysis.shots.some((s) => !visual!.shots.some((v) => v.id === s.id))
        )
          throw new Error("Gemini omitted a detected shot. Retry analysis.");
        await saveRecord("cache", { id: visualKey, ...visual });
      }
      const speakers = [
        ...speech.speakers.map((s) => ({
          ...s,
          ...visual!.speakers.find((v) => v.id === s.id),
        })),
        ...visual.speakers.filter(
          (v) => !speech.speakers.some((s) => s.id === v.id),
        ),
      ];
      if (new Set(speakers.map((s) => s.id)).size !== speakers.length)
        throw new Error(
          "Gemini returned duplicate actor labels. Retry analysis.",
        );
      speech = { ...speech, speakers };
      const updated: Analysis = {
        ...analysis,
        ...speech,
        status: "ANALYZED",
        model,
        revision: analysis.revision + 1,
        shots: analysis.shots.map((s) => ({
          ...s,
          ...visual!.shots.find((v) => v.id === s.id),
          start: s.start,
          end: s.end,
        })),
        warnings: [
          ...analysis.warnings,
          "AI dialogue is a draft, not guaranteed exact. Review words, speaker labels and timestamps against the source before TTS.",
        ],
      };
      return saveRecord("analyses", updated);
    } finally {
      await ai.files.delete({ name: uploaded.name }).catch(() => undefined);
    }
  }
}
