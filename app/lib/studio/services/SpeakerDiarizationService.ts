import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Analysis, Interval, Speaker, Turn } from "../types";
import { speakerSchema, turnSchema } from "../validation";
import { googleRequest, jsonOutput, type Interaction } from "../server/google";
import { assetPath } from "../server/store";
import { z } from "zod";

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

  static async transcribe(
    analysis: Analysis,
    audio: string,
    apiKey: string,
    model: string,
  ): Promise<{ speakers: Speaker[]; turns: Turn[] }> {
    const result = await googleRequest<Interaction>("interactions", apiKey, {
      model,
      store: false,
      input: [
        {
          type: "audio",
          mime_type: "audio/flac",
          data: (await readFile(assetPath(audio))).toString("base64"),
        },
        {
          type: "text",
          text: `Transcribe every speaker turn verbatim, including profanity, repetitions and code-switching in Filipino, English or Taglish. Never translate, censor, paraphrase or invent words. Use [unintelligible] for unclear speech. Identify consistent anonymous speakers, including offscreen voices. Return ONLY JSON: {"speakers":[{"id":"speaker_1","name":"Speaker 1","description":"audible voice traits"}],"turns":[{"id":"turn_1","speakerId":"speaker_1","start":0.1,"end":1.3,"text":"exact words","emotion":"delivery such as shouting/whispering/sadness/laughter","gesture":"","reviewed":false}]}. Timestamps are decimal seconds from source start. Source duration ${analysis.media.duration}. Use these independently measured non-silent intervals as timing evidence (they may include music, not just speech): ${JSON.stringify(analysis.activity)}. Split at speaker changes; retain overlapping speakers. Output empty lists if there is no speech.`,
        },
      ],
    });
    const parsed = z
      .object({ speakers: z.array(speakerSchema), turns: z.array(turnSchema) })
      .parse(jsonOutput(result));
    // Only snap close endpoints to independently measured activity; do not collapse pauses or overlapping dialogue.
    const endpoints = analysis.activity.flatMap((a) => [a.start, a.end]);
    const snap = (t: number) =>
      endpoints.reduce(
        (best, n) => (Math.abs(n - t) < Math.abs(best - t) ? n : best),
        t + 0.151,
      );
    const turns = parsed.turns
      .map((turn) => {
        const start = snap(turn.start),
          end = snap(turn.end);
        return {
          ...turn,
          id: randomUUID(),
          reviewed: false,
          start: Math.max(
            0,
            Math.abs(start - turn.start) <= 0.15 ? start : turn.start,
          ),
          end: Math.min(
            analysis.media.duration,
            Math.abs(end - turn.end) <= 0.15 ? end : turn.end,
          ),
        };
      })
      .filter((t) => t.end > t.start);
    if (turns.some((t) => !parsed.speakers.some((s) => s.id === t.speakerId)))
      throw new Error(
        "Transcription returned an unknown speaker. Retry analysis.",
      );
    return { speakers: parsed.speakers, turns };
  }
}
