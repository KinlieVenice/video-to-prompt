import path from "node:path";
import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import type { Analysis, Character, Project, Version } from "../types";
import {
  assetPath,
  newAsset,
  signature,
  writeAsset,
  root,
} from "../server/store";
import { probe, run } from "../server/ffmpeg";
import { VoiceService } from "./VoiceService";
import { segmentMotion, segmentOpeningState } from "../motion";
import { reenactmentRange } from "../range";
import { assemblyTimeline } from "../assembly";
import { visualDirection } from "../visualDirection";
import { appearanceNotes } from "../appearance";

export function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitles(
  analysis: Analysis,
  version?: Version,
  characters: Character[] = [],
) {
  const range = reenactmentRange(analysis, version);
  const timed = analysis.turns
    .map((turn) => {
      if (!version || version.audioMode === "SILENT") return turn;
      const timing =
        version.audioMode === "CHARACTER_TTS"
          ? version.turnTiming[turn.id]
          : undefined;
      const start = turn.start + version.audioOffset + (timing?.offset || 0);
      const character = characters.find(
        (c) => c.id === version.mappings[turn.speakerId],
      );
      const takes = version.audioTakes[turn.id] || [];
      const take =
        takes.find((t) => t.asset === version.selectedTakes[turn.id]) ||
        takes.at(-1);
      const end =
        version.audioMode === "CHARACTER_TTS" && take && character
          ? start +
            take.duration / ((timing?.speed || 1) * character.voice.speed)
          : turn.end + version.audioOffset;
      return {
        ...turn,
        start: Math.max(0, start),
        end: Math.min(analysis.media.duration, end),
      };
    })
    .map((turn) => ({
      ...turn,
      start: Math.max(range.start, turn.start) - range.start,
      end: Math.min(range.end, turn.end) - range.start,
    }))
    .filter((turn) => turn.end > turn.start);
  return timed
    .sort((a, b) => a.start - b.start)
    .map(
      (turn, i) =>
        `${i + 1}\n${srtTime(turn.start)} --> ${srtTime(turn.end)}\n${turn.text.replace(/[\r\n]+/g, " ")}\n`,
    )
    .join("\n");
}
export function tempoFilters(speed: number) {
  const filters: string[] = [];
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  filters.push(`atempo=${speed}`);
  return filters.join(",");
}
export class VideoAssemblyService {
  static key(analysis: Analysis, version: Version, characters: Character[]) {
    const {
      exportAsset: _asset,
      exportSignature: _signature,
      ...settings
    } = version;
    void _asset;
    void _signature;
    return signature({
      revision: analysis.revision,
      source: analysis.sourceHash,
      settings,
      voices: characters
        .filter((c) => Object.values(version.mappings).includes(c.id))
        .map((c) => ({ id: c.id, voice: c.voice })),
    });
  }
  static async assemble(
    analysis: Analysis,
    version: Version,
    characters: Character[],
  ) {
    if (!version.segments.length || version.planRevision !== analysis.revision)
      throw new Error("Plan segments again after editing analysis.");
    const range = reenactmentRange(analysis, version);
    const total = range.end - range.start;
    let cursor = range.start;
    for (const segment of version.segments) {
      if (
        segment.start < range.start - 0.005 ||
        segment.end > range.end + 0.005 ||
        segment.end <= segment.start
      )
        throw new Error(
          "Segment plan is outside the reenactment range. Replan segments.",
        );
      if (Math.abs(segment.start + segment.overlap - cursor) > 0.005)
        throw new Error(
          "Segment plan has a timeline gap or incompatible overlap.",
        );
      cursor = segment.end;
      if (!version.clips[segment.id])
        throw new Error("Import a generated clip for every segment.");
    }
    if (Math.abs(cursor - range.end) > 0.005)
      throw new Error("Segment plan does not cover the reenactment range.");
    const [width, height] =
      version.aspect === "9:16" ? [720, 1280] : [1280, 720];
    const normalized: string[] = [];
    const timeline = assemblyTimeline(analysis, version);
    let outputCursor = 0;
    for (const [index, segment] of version.segments.entries()) {
      const clip = version.clips[segment.id];
      const media = await probe(assetPath(clip.asset));
      const { trim, duration, end } = timeline[index];
      if (!media.width || trim < 0 || media.duration - trim <= 0.001)
        throw new Error(
          `Clip ${segment.id} ends before its trim and overlap. Adjust trim or upload a longer clip.`,
        );
      const output = await newAsset("mp4");
      // Round cumulative boundaries, avoiding per-clip rounding drift on long timelines.
      const nextFrame = Math.round(end * 30),
        frames = nextFrame - Math.round(outputCursor * 30);
      if (frames < 1)
        throw new Error(
          "A shot is shorter than one export frame. Correct the shot boundary before assembly.",
        );
      await run("ffmpeg", [
        "-y",
        "-ss",
        String(trim),
        "-i",
        assetPath(clip.asset),
        "-an",
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${duration + 0.05}`,
        "-frames:v",
        String(frames),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        output.path,
      ]);
      outputCursor = end;
      normalized.push(output.asset);
    }
    const list = await writeAsset(
      normalized.map((a) => `file '${a}'`).join("\n"),
      "json",
    );
    const joined = await newAsset("mp4");
    await run(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        path.basename(assetPath(list)),
        "-c",
        "copy",
        joined.path,
      ],
      path.join(root(), "assets"),
    );
    const inputs = ["-y", "-i", joined.path];
    const filters: string[] = [];
    let audioIndex = 1;
    const addAudio = (asset: string) => {
      inputs.push("-i", assetPath(asset));
      return audioIndex++;
    };
    const offsetFilter = (offset: number) =>
      `atrim=start=${Math.max(0, -offset)},asetpts=PTS-STARTPTS,adelay=${Math.round(Math.max(0, offset) * 1000)}:all=1`;
    const selectedAudio = `apad,atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS`;
    let hasAudio = false;
    if (version.audioMode === "FLOW_CLIPS") {
      const labels: string[] = [];
      for (const [placementIndex, segment] of version.segments.entries()) {
        const clip = version.clips[segment.id];
        const media = await probe(assetPath(clip.asset));
        if (!media.hasAudio) continue;
        const index = addAudio(clip.asset),
          label = `clip${index}`;
        const { trim, duration, start: delay } = timeline[placementIndex];
        filters.push(
          `[${index}:a]atrim=start=${trim}:duration=${duration},asetpts=PTS-STARTPTS,adelay=${Math.round(delay * 1000)}:all=1[${label}]`,
        );
        labels.push(`[${label}]`);
      }
      if (!labels.length)
        throw new Error(
          "The imported clips have no audio tracks. Choose another audio mode.",
        );
      filters.push(
        `${labels.join("")}amix=inputs=${labels.length}:normalize=0,${offsetFilter(version.audioOffset)},apad,atrim=duration=${total}[audio]`,
      );
      hasAudio = true;
    } else if (version.audioMode === "ORIGINAL") {
      if (analysis.media.hasAudio) {
        const index = addAudio(analysis.sourceAsset);
        filters.push(
          `[${index}:a]${offsetFilter(version.audioOffset)},${selectedAudio}[audio]`,
        );
        hasAudio = true;
      }
    } else if (version.audioMode === "UPLOADED") {
      if (!version.uploadedAudio)
        throw new Error("Upload an audio recording first.");
      const index = addAudio(version.uploadedAudio);
      filters.push(
        `[${index}:a]${offsetFilter(version.audioOffset)},${selectedAudio}[audio]`,
      );
      hasAudio = true;
    } else if (version.audioMode === "CHARACTER_TTS") {
      const labels: string[] = [];
      for (const turn of analysis.turns.filter((t) => t.text.trim())) {
        const character = characters.find(
          (c) => c.id === version.mappings[turn.speakerId],
        );
        const takes = version.audioTakes[turn.id] || [];
        const take =
          takes.find((t) => t.asset === version.selectedTakes[turn.id]) ||
          takes.at(-1);
        const timing = version.turnTiming[turn.id] || { offset: 0, speed: 1 };
        const speed = timing.speed * (character?.voice.speed || 1);
        const start = turn.start + timing.offset + version.audioOffset;
        const expectedEnd = take
          ? start + take.duration / speed
          : turn.end + timing.offset + version.audioOffset;
        if (start >= range.end || expectedEnd <= range.start) continue;
        if (!character)
          throw new Error(
            "Map every speaking actor before assembling character audio.",
          );
        if (!take || take.signature !== VoiceService.key(turn, character.voice))
          throw new Error(
            "Generate current audio for every line. A line or saved voice has changed.",
          );
        const length = take.duration / speed;
        if (
          start < 0 ||
          start + length > turn.end + 0.04 ||
          start + length > analysis.media.duration + 0.04
        )
          throw new Error(
            `Dialogue exceeds its allocated duration: ${turn.text.slice(0, 70)}. Adjust timing or speed without changing its words.`,
          );
        const index = addAudio(take.asset),
          label = `line${index}`;
        filters.push(
          `[${index}:a]${tempoFilters(speed)},asetpts=PTS-STARTPTS,adelay=${Math.round(start * 1000)}:all=1[${label}]`,
        );
        labels.push(`[${label}]`);
      }
      if (version.backgroundAudio) {
        const index = addAudio(version.backgroundAudio);
        filters.push(
          `[${index}:a]${offsetFilter(version.audioOffset)}[background]`,
        );
        labels.push("[background]");
      }
      if (labels.length) {
        filters.push(
          `${labels.join("")}amix=inputs=${labels.length}:normalize=0,alimiter=limit=0.95,${selectedAudio}[audio]`,
        );
        hasAudio = true;
      }
    }
    let subtitleIndex: number | undefined;
    const captions = version.subtitles
      ? subtitles(analysis, version, characters)
      : "";
    if (captions) {
      const asset = await writeAsset(captions, "srt");
      subtitleIndex = audioIndex++;
      inputs.push("-i", assetPath(asset));
    }
    const output = await newAsset("mp4");
    const args = [...inputs];
    if (filters.length) args.push("-filter_complex", filters.join(";"));
    args.push("-map", "0:v:0");
    if (hasAudio) args.push("-map", "[audio]");
    if (subtitleIndex !== undefined)
      args.push(
        "-map",
        `${subtitleIndex}:s:0`,
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=und",
      );
    if (version.disclosure) {
      const asset = await writeAsset(
        `1\n00:00:00,000 --> ${srtTime(total)}\nAI reenactment\n`,
        "srt",
      );
      args.push(
        "-vf",
        `subtitles=${asset}:force_style='Alignment=7,FontSize=14,MarginL=14,MarginV=14'`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-metadata",
        "comment=AI reenactment; generated visuals and optional synthetic voices",
      );
    } else args.push("-c:v", "copy");
    if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push("-t", String(total), "-movflags", "+faststart", output.path);
    await run("ffmpeg", args, path.join(root(), "assets"));
    const exported = await probe(output.path);
    if (Math.abs(exported.duration - total) > 0.1)
      throw new Error(
        "Export timing drift exceeded 100ms. Review the imported clip durations.",
      );
    return {
      asset: output.asset,
      signature: this.key(analysis, version, characters),
    };
  }
  static package(
    project: Project,
    analysis: Analysis,
    version: Version,
    characters: Character[],
    prompts: Record<string, string>,
  ) {
    return {
      schemaVersion: 1,
      project: project.name,
      version: version.name,
      source: { name: analysis.sourceName, duration: analysis.media.duration },
      sourceRange: reenactmentRange(analysis, version),
      visualDirection: visualDirection(version),
      audioMode: version.audioMode,
      target: version.target,
      segments: version.segments.map((segment) => ({
        ...segment,
        prompt: prompts[segment.id],
        motionPlan: segmentMotion(
          analysis.shots.find((s) => s.id === segment.shotId)!,
          segment,
        ),
        incomingState: segmentOpeningState(
          analysis.shots.find((s) => s.id === segment.shotId)!,
          segment.start,
        ),
        motionEvidence: (
          analysis.shots.find((s) => s.id === segment.shotId)?.motionBeats || []
        ).filter((b) => b.start < segment.end && b.end >= segment.start),
        dialogue: analysis.turns.filter(
          (t) => t.end > segment.start && t.start < segment.end,
        ),
        frames: version.frames[segment.id],
      })),
      characters: characters.filter((c) =>
        Object.values(version.mappings).includes(c.id),
      ),
      mappings: version.mappings,
      appearanceNotes: appearanceNotes(version),
      estimatedFlowCredits: version.segments.reduce((n, s) => n + s.credits, 0),
      note: "Download frame and character image files beside this manifest. Google Flow generation is manual. No video-to-video editing.",
    };
  }
  static async downloadPackage(
    project: Project,
    analysis: Analysis,
    version: Version,
    characters: Character[],
    prompts: Record<string, string>,
  ) {
    const manifest = this.package(
      project,
      analysis,
      version,
      characters,
      prompts,
    );
    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "README.txt": strToU8(
        "Manual Google Flow package\n\nEach segment has a numbered prompt. The manifest associates frames and character image filenames with each segment. Upload the relevant replaced frame and character images to Flow, select the model and duration, paste the prompt and generate manually. Download each generated clip and import it into the matching segment in RE/CAST. Source video is not included. If no replaced frames are listed, generate them in the workspace first. Original frames are composition references, not character replacements. No video-to-video editing or Flow automation is used.\n",
      ),
    };
    const assets = new Set<string>();
    for (const [i, segment] of version.segments.entries()) {
      files[`segment-${String(i + 1).padStart(2, "0")}-prompt.txt`] = strToU8(
        prompts[segment.id],
      );
      const frame = version.frames[segment.id];
      if (frame) {
        assets.add(frame.first);
        assets.add(frame.last);
        if (frame.generated) {
          assets.add(frame.generated.first);
          assets.add(frame.generated.last);
        }
        for (const moment of frame.moments || []) assets.add(moment.asset);
      }
    }
    for (const character of manifest.characters)
      for (const reference of character.references) assets.add(reference);
    for (const segment of manifest.segments)
      for (const beat of segment.motionEvidence)
        if (beat.evidence) {
          assets.add(beat.evidence.before.asset);
          assets.add(beat.evidence.after.asset);
        }
    for (const asset of assets) files[asset] = await readFile(assetPath(asset));
    return writeAsset(Buffer.from(zipSync(files, { level: 0 })), "zip");
  }
}
