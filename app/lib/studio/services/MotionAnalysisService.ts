import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Interval, MotionBeat, Shot } from "../types";
import {
  assetExists,
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
} from "../server/store";
import { extractSourceFrame, run } from "../server/ffmpeg";
import type { ChatContent } from "../server/openai";
import { formatMotion } from "../motion";

export const MOTION_WINDOW_SECONDS = 8;
export const MOTION_BASE_INTERVAL = 0.5;
export const MOTION_FINE_INTERVAL = 0.25;
export const MAX_MOTION_FRAMES = 33;
export const rawBeatSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  action: z.string().min(1).max(4000),
  phase: z.enum(["SETUP", "ACTION", "REACTION", "RECOVERY", "HOLD"]),
  importance: z.enum(["KEY", "NORMAL"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  anchorTime: z.number().finite(),
  timingKind: z.enum(["ACTIVITY", "TRANSITION", "OBSERVATION"]).optional(),
  onset: z
    .object({ start: z.number().finite(), end: z.number().finite() })
    .nullable()
    .optional(),
  continuing: z.boolean().optional(),
  settled: z.boolean().optional(),
  stateBefore: z.string().max(2000).optional(),
  stateAfter: z.string().max(2000).optional(),
});
export type ChangeScore = { time: number; score: number };

export class MotionAnalysisService {
  static windows(shot: Interval): Interval[] {
    const windows: Interval[] = [];
    for (
      let start = shot.start;
      start < shot.end - 0.000001;
      start += MOTION_WINDOW_SECONDS
    )
      windows.push({
        start,
        end: Math.min(shot.end, start + MOTION_WINDOW_SECONDS),
      });
    return windows;
  }
  static frameTimes(
    window: Interval,
    fps: number,
    interval = MOTION_BASE_INTERVAL,
  ): number[] {
    const last = Math.max(window.start, window.end - 1 / (fps || 24));
    const times = [window.start];
    const step = Math.max(interval, 1 / (fps || 24));
    for (let t = window.start + step; t < last; t += step) times.push(t);
    times.push(last);
    return [...new Set(times.map((t) => Number(t.toFixed(6))))].sort(
      (a, b) => a - b,
    );
  }
  static maxGap(times: number[]) {
    return times.reduce(
      (max, t, i) => (i ? Math.max(max, t - times[i - 1]) : max),
      0,
    );
  }
  static parseChanges(log: string): ChangeScore[] {
    const result: ChangeScore[] = [];
    let time: number | undefined;
    for (const line of log.split(/\r?\n/)) {
      const timestamp = line.match(/pts_time:([\d.e+-]+)/);
      if (timestamp) time = Number(timestamp[1]);
      const value = line.match(/lavfi.signalstats.YAVG=([\d.e+-]+)/);
      if (value && time !== undefined && Number.isFinite(time))
        result.push({ time, score: Number(value[1]) });
    }
    return result.filter((s) => Number.isFinite(s.score));
  }
  static async changes(
    sourceHash: string,
    sourceAsset: string,
  ): Promise<ChangeScore[]> {
    const id = `motion-changes-${signature({ sourceHash, version: 1 })}`;
    const cached = await cacheGet<{ scores: ChangeScore[] }>(id);
    if (cached) return cached.scores;
    const result = await run("ffmpeg", [
      "-hide_banner",
      "-i",
      assetPath(sourceAsset),
      "-an",
      "-vf",
      "fps=4,scale=160:-2,tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ]);
    const scores = this.parseChanges(result.stdout);
    await saveRecord("cache", { id, scores });
    return scores;
  }
  static rapidRanges(window: Interval, scores: ChangeScore[]): Interval[] {
    const inside = scores.filter(
      (s) => s.time > window.start + 0.25 && s.time < window.end - 0.25,
    );
    if (!inside.length) return [];
    const mean = inside.reduce((n, s) => n + s.score, 0) / inside.length;
    const deviation = Math.sqrt(
      inside.reduce((n, s) => n + (s.score - mean) ** 2, 0) / inside.length,
    );
    const selected: ChangeScore[] = [];
    for (const point of inside
      .filter((s) => s.score > Math.max(2, mean + deviation))
      .sort((a, b) => b.score - a.score)) {
      if (selected.every((s) => Math.abs(s.time - point.time) > 1))
        selected.push(point);
      if (selected.length === 2) break;
    }
    return selected.map((s) => ({
      start: Math.max(window.start, s.time - 0.5),
      end: Math.min(window.end, s.time + 0.5),
    }));
  }
  static addFineSamples(
    times: number[],
    ranges: Interval[],
    fps: number,
    limit = MAX_MOTION_FRAMES,
  ) {
    const merged = new Set(times);
    for (const range of ranges) {
      for (const t of this.frameTimes(range, fps, MOTION_FINE_INTERVAL)) {
        if (merged.size >= limit) break;
        // Do not manufacture additional temporal precision below the source frame duration.
        if (
          [...merged].every(
            (s) => Math.abs(s - t) >= Math.max(0.001, 0.75 / (fps || 24)),
          )
        )
          merged.add(t);
      }
    }
    return [...merged].sort((a, b) => a - b);
  }
  static beats(
    raw: z.infer<typeof rawBeatSchema>[],
    times: number[],
    window: Interval,
    context?: {
      shotStart: number;
      previous?: MotionBeat;
      endingSettled?: boolean;
    },
  ): MotionBeat[] {
    return raw
      .map((beat): MotionBeat => {
        if (
          beat.start < window.start - 0.01 ||
          beat.end > window.end + 0.01 ||
          beat.end < beat.start ||
          beat.anchorTime < beat.start - 0.01 ||
          beat.anchorTime > beat.end + 0.01
        )
          throw new Error(
            "The model returned motion outside its analysis window. Retry motion analysis.",
          );
        // Widen estimated timings to the actual surrounding observations. Never infer millisecond precision.
        const start =
          [...times].reverse().find((t) => t <= beat.start + 0.001) ?? times[0];
        const end = times.find((t) => t >= beat.end - 0.001) ?? times.at(-1)!;
        let evidenceTimes = times.filter((t) => t >= start && t <= end);
        const anchorTime = evidenceTimes.reduce(
          (best, t) =>
            Math.abs(t - beat.anchorTime) < Math.abs(best - beat.anchorTime)
              ? t
              : best,
          evidenceTimes[0],
        );
        const timingNotes: string[] = [];
        let phase = beat.phase;
        let continuing = beat.continuing || false;
        if (
          phase === "SETUP" &&
          window.start > (context?.shotStart ?? window.start)
        ) {
          phase =
            context?.previous &&
            ["ACTION", "REACTION"].includes(context.previous.phase)
              ? context.previous.phase
              : "HOLD";
          continuing = true;
          timingNotes.push(
            "Continuation of the same shot; a new analysis window does not restart the performance.",
          );
        }
        if (
          phase === "RECOVERY" &&
          (!beat.settled ||
            !beat.stateAfter?.trim() ||
            (context?.endingSettled === false && end >= times.at(-1)! - 0.5))
        ) {
          phase = "ACTION";
          timingNotes.push(
            "Recovery is unverified: no observed settled state was supplied. Treat as ongoing action.",
          );
        }
        let onset: Interval | undefined;
        if (beat.onset && !continuing) {
          if (
            beat.onset.start < window.start - 0.01 ||
            beat.onset.end < beat.onset.start ||
            beat.onset.end > beat.end + 0.01
          )
            throw new Error(
              "The model returned onset uncertainty outside its observed action window.",
            );
          onset = {
            start:
              [...times]
                .reverse()
                .find((t) => t <= beat.onset!.start + 0.001) ?? times[0],
            end:
              times.find((t) => t >= beat.onset!.end - 0.001) ?? times.at(-1)!,
          };
          evidenceTimes = [
            ...new Set([
              ...evidenceTimes,
              ...times.filter((t) => t >= onset!.start && t <= onset!.end),
            ]),
          ].sort((a, b) => a - b);
        }
        const hasStatePair = Boolean(
          beat.stateBefore?.trim() &&
          beat.stateAfter?.trim() &&
          evidenceTimes.length >= 2,
        );
        const confidence =
          hasStatePair && this.maxGap(evidenceTimes) <= 0.500001
            ? "MEDIUM"
            : "LOW";
        return {
          ...beat,
          start,
          end,
          anchorTime,
          evidenceTimes,
          reviewed: false,
          phase,
          continuing,
          onset,
          confidence,
          timingNotes: timingNotes.length ? timingNotes : undefined,
          id: `motion_${signature({ start, end, action: beat.action }).slice(0, 24)}`,
        };
      })
      .sort((a, b) => a.start - b.start);
  }
  static refinementRanges(beats: MotionBeat[], window: Interval): Interval[] {
    return beats
      .filter(
        (b) =>
          b.importance === "KEY" &&
          !b.continuing &&
          Boolean(b.onset && b.onset.end - b.onset.start >= 0.4),
      )
      .sort(
        (a, b) =>
          (b.confidence === "LOW" ? 1 : 0) - (a.confidence === "LOW" ? 1 : 0),
      )
      .slice(0, 2)
      .map((b) => ({
        start: Math.max(window.start, b.onset!.start - 0.25),
        end: Math.min(window.end, b.onset!.start + 1.25),
      }));
  }
  static format(beats: MotionBeat[]) {
    return formatMotion(beats);
  }
  static async evidence(
    sourceHash: string,
    sourceAsset: string,
    beat: MotionBeat,
    bounds?: { start: number; end: number; fps: number },
  ) {
    const clamp = (t: number) =>
      bounds
        ? Math.max(
            bounds.start,
            Math.min(t, bounds.end - 1 / (bounds.fps || 24)),
          )
        : t;
    const before = clamp(beat.onset?.start ?? beat.start),
      after = clamp(beat.onset?.end ?? beat.end);
    return {
      before: {
        time: before,
        asset: await this.frame(sourceHash, sourceAsset, before),
      },
      after: {
        time: after,
        asset: await this.frame(sourceHash, sourceAsset, after),
      },
    };
  }
  static async frame(
    sourceHash: string,
    sourceAsset: string,
    time: number,
  ): Promise<string> {
    const id = `vision-frame-${signature({ source: sourceHash, time, width: 768 })}`;
    const cached = await cacheGet<{ asset: string }>(id);
    if (cached && (await assetExists(cached.asset))) return cached.asset;
    const frame = await newAsset("jpg");
    await extractSourceFrame(assetPath(sourceAsset), frame.path, time, {
      width: 768,
      quality: 3,
    });
    await saveRecord("cache", { id, asset: frame.asset });
    return frame.asset;
  }
  static async content(
    sourceHash: string,
    sourceAsset: string,
    times: number[],
    prompt: string,
    continuityFrame?: { time: number; asset: string },
  ): Promise<ChatContent[]> {
    const content: ChatContent[] = [{ type: "text", text: prompt }];
    if (continuityFrame)
      content.push(
        {
          type: "text",
          text: `Continuity context BEFORE this window at ${continuityFrame.time.toFixed(3)}s. Do not replay it as a new setup.`,
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${(await readFile(assetPath(continuityFrame.asset))).toString("base64")}`,
            detail: "high",
          },
        },
      );
    for (const time of times) {
      const asset = await this.frame(sourceHash, sourceAsset, time);
      content.push(
        { type: "text", text: `Source sample at ${time.toFixed(3)} seconds` },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${(await readFile(assetPath(asset))).toString("base64")}`,
            detail: "high",
          },
        },
      );
    }
    return content;
  }
}
