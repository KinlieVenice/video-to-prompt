import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RouterConnection } from "../connection";
import type { Analysis, Interval, Speaker, Turn } from "../types";
import { assetPath } from "../server/store";
import { routerRequest } from "../server/openai";

export class SpeakerDiarizationService {
  static activity(log: string, duration: number): Interval[] {
    const silence: Interval[] = [];
    let start: number | undefined;
    for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
      const value = Math.min(duration, Number(match[2]));
      if (match[1] === "start") start = value;
      else {
        silence.push({ start: start ?? 0, end: value });
        start = undefined;
      }
    }
    if (start !== undefined) silence.push({ start, end: duration });
    let cursor = 0;
    const active: Interval[] = [];
    for (const gap of silence) {
      if (gap.start > cursor) active.push({ start: cursor, end: gap.start });
      cursor = gap.end;
    }
    if (cursor < duration) active.push({ start: cursor, end: duration });
    return active;
  }

  static parseTranscript(
    value: unknown,
    duration: number,
  ): { speakers: Speaker[]; turns: Turn[] } {
    const parsed = z
      .object({
        segments: z
          .array(
            z.object({
              start: z.number().finite().min(0),
              end: z.number().finite().min(0),
              text: z.string().max(20_000),
              speaker: z.string().max(100).optional(),
            }),
          )
          .max(5000),
      })
      .parse(value);
    const labels = new Map<string, string>();
    const turns = parsed.segments
      .filter((s) => s.text.trim())
      .map((segment): Turn => {
        if (
          segment.end <= segment.start ||
          segment.start >= duration ||
          segment.end > duration + 0.25
        )
          throw new Error(
            "Transcription returned timestamps outside the source. No transcript was saved.",
          );
        const label = segment.speaker || "unassigned";
        if (!labels.has(label)) labels.set(label, `speaker_${randomUUID()}`);
        return {
          id: randomUUID(),
          speakerId: labels.get(label)!,
          start: segment.start,
          end: Math.min(duration, segment.end),
          text: segment.text,
          emotion: "",
          gesture: "",
          reviewed: false,
        };
      });
    return {
      speakers: [...labels].map(([label, id]) => ({
        id,
        name:
          label === "unassigned" ? "Unassigned speaker" : `Speaker ${label}`,
        description:
          label === "unassigned"
            ? "Transcription has no speaker diarization. Split turns and assign speakers manually; do not assume one person."
            : "Provider speaker label; verify identity and overlapping speech against the source.",
      })),
      turns,
    };
  }

  static async transcribe(
    analysis: Analysis,
    audio: string,
    connection: RouterConnection,
  ) {
    let result: unknown;
    if (connection.transcription === "ROUTER") {
      if (!connection.transcriptionModel)
        throw new Error(
          "Set a timestamp-capable transcription model in Settings.",
        );
      const form = new FormData();
      form.set("model", connection.transcriptionModel);
      form.set("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      if (connection.language !== "auto")
        form.set("language", connection.language);
      form.set(
        "prompt",
        "Filipino, English and Taglish. Preserve original words, profanity and code-switching. Do not translate.",
      );
      form.set(
        "file",
        new Blob([await readFile(assetPath(audio))], { type: "audio/wav" }),
        "source.wav",
      );
      result = await (
        await routerRequest(connection, "audio/transcriptions", form)
      ).json();
    } else {
      result = await this.localTranscription(
        assetPath(audio),
        connection.language,
      );
    }
    return this.parseTranscript(result, analysis.media.duration);
  }

  static async localTranscription(
    file: string,
    language: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        /* turbopackIgnore: true */ process.env.STUDIO_PYTHON || "python",
        [path.join(process.cwd(), "scripts", "transcribe.py"), file, language],
        {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
      );
      child.stdout.setEncoding("utf8");
      let output = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            "Local transcription exceeded 15 minutes. Use a smaller Whisper model or manual transcript mode.",
          ),
        );
      }, 900_000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 8_000_000) child.kill();
      });
      // Drain diagnostics without exposing local paths or logging transcript media.
      child.stderr.resume();
      const help =
        "Local Whisper could not run. Install Python and faster-whisper (python -m pip install -r scripts/requirements-whisper.txt), set STUDIO_PYTHON if needed, or choose manual transcript mode in Settings. The first run downloads model weights.";
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error(help));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(help));
          return;
        }
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error("Local transcription returned invalid JSON."));
        }
      });
    });
  }
}
