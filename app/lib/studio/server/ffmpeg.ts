import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { MediaInfo } from "../types";

export function binary(tool: "ffmpeg" | "ffprobe"): string {
  if (tool === "ffmpeg")
    return process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";
  return process.env.FFPROBE_PATH || ffprobeStatic.path;
}
export async function run(
  tool: "ffmpeg" | "ffprobe",
  args: string[],
  cwd?: string,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    // Runtime binaries and user media are supplied locally, not copied into the build trace.
    const child = spawn(/* turbopackIgnore: true */ binary(tool), args, {
      shell: false,
      windowsHide: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      done = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${tool} exceeded the 15 minute limit.`));
    }, 900_000);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-16_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16_000_000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      done = true;
      reject(
        new Error(
          `${tool} could not start. Install dependencies or set ${tool.toUpperCase()}_PATH.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (done) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${tool} failed: ${stderr.slice(-1800)}`));
    });
  });
}
export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    file,
  ]);
  const info = JSON.parse(stdout);
  const video = info.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const [num, den] = String(video?.avg_frame_rate || "0/1")
    .split("/")
    .map(Number);
  const duration = Number(info.format.duration || video?.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Media has no valid duration.");
  return {
    duration,
    width: video?.width || 0,
    height: video?.height || 0,
    fps: num / (den || 1),
    hasAudio: info.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}

// A container's audio can outlast its video. FFmpeg can exit successfully after
// seeking into that tail without writing an image. Use the last observed video
// frame at or before the requested time, keeping the full source/audio timeline.
export async function extractSourceFrame(
  source: string,
  output: string,
  time: number,
  options: { width?: number; quality?: number } = {},
) {
  if (!Number.isFinite(time) || time < 0)
    throw new Error("Choose a finite, non-negative source frame time.");
  const capture = async (timestamp: number) => {
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(timestamp),
      "-i",
      source,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      ...(options.width ? ["-vf", `scale=${options.width}:-2`] : []),
      ...(options.quality ? ["-q:v", String(options.quality)] : []),
      "-update",
      "1",
      output,
    ]);
    try {
      return (await stat(output)).size > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  if (await capture(time)) return;

  // Decode timestamps only on an empty seek. Stream duration / average FPS alone
  // cannot locate the final real frame reliably for variable-frame-rate media.
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=start_time,duration:frame=best_effort_timestamp_time",
    "-of",
    "json",
    source,
  ]);
  const info = JSON.parse(stdout);
  const duration = Number(info.format?.duration);
  const origin = Number(info.format?.start_time || 0);
  const times: number[] = (info.frames || [])
    .map(
      (frame: { best_effort_timestamp_time?: string }) =>
        Number(frame.best_effort_timestamp_time) - origin,
    )
    .filter(
      (timestamp: number) => Number.isFinite(timestamp) && timestamp <= time,
    );
  const last = times.length
    ? times.reduce((latest, timestamp) => Math.max(latest, timestamp))
    : undefined;
  if (
    Number.isFinite(duration) &&
    time < duration &&
    last !== undefined &&
    // Account for the precision of ffprobe's printed timestamps.
    (await capture(Math.max(0, last - 0.000001)))
  )
    return;
  throw new Error(
    "No source frame exists at the requested time. Choose a time inside the video.",
  );
}

export async function probeImage(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name",
    "-of",
    "json",
    file,
  ]);
  const image = JSON.parse(stdout).streams?.[0];
  if (
    !image?.width ||
    !image?.height ||
    !["png", "mjpeg", "webp"].includes(image.codec_name)
  )
    throw new Error("Reference must be a valid PNG, JPEG or WebP image.");
  return image as { width: number; height: number; codec_name: string };
}
