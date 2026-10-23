import { spawn } from "node:child_process";
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
