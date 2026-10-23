import { readFile } from "node:fs/promises";
import type { Analysis, Character, Frames, Segment, Version } from "../types";
import type { RouterConnection } from "../connection";
import {
  assetExists,
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
  writeAsset,
} from "../server/store";
import { extractSourceFrame } from "../server/ffmpeg";
import { routerRequest, routerBaseUrl } from "../server/openai";
import { probeImage } from "../server/ffmpeg";
import { MotionAnalysisService } from "./MotionAnalysisService";
import { continuousPredecessor, referenceLinkCurrent } from "../references";

export interface ImageGenerationProvider {
  replace(input: {
    source: string;
    references: { asset: string; description: string }[];
    prompt: string;
    model: string;
    connection: RouterConnection;
  }): Promise<string>;
}
export class OpenAIImageProvider implements ImageGenerationProvider {
  async replace(input: Parameters<ImageGenerationProvider["replace"]>[0]) {
    if (!input.connection.imagesEnabled)
      throw new Error(
        "Enable the optional image route in Settings after verifying image generation in 9router.",
      );
    const images = await Promise.all(
      [input.source, ...input.references.map((r) => r.asset)].map(
        async (asset) => {
          const mime = asset.endsWith(".jpg")
            ? "image/jpeg"
            : asset.endsWith(".webp")
              ? "image/webp"
              : "image/png";
          return `data:${mime};base64,${(await readFile(assetPath(asset))).toString("base64")}`;
        },
      ),
    );
    // 9router's Codex adapter accepts reference images on this JSON endpoint.
    // This is a router extension, not the official OpenAI Images API edits schema.
    const response = await routerRequest(
      input.connection,
      "images/generations",
      {
        model: input.model,
        n: 1,
        output_format: "png",
        response_format: "b64_json",
        images,
        prompt: `Image 1 is the source composition. ${input.references.map((r, i) => `Image ${i + 2}: ${r.description}`).join(" ")} ${input.prompt}`,
      },
    );
    const result = await response.json();
    const encoded = result.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || !encoded.length)
      throw new Error(
        "9router returned no base64 image. Select a reference-capable Codex image route.",
      );
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.length > 25 * 1024 * 1024 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error(
        "9router returned an invalid or oversized PNG reference image.",
      );
    const asset = await writeAsset(bytes, "png");
    await probeImage(assetPath(asset));
    return asset;
  }
}
export class KeyframeService {
  constructor(
    private provider: ImageGenerationProvider = new OpenAIImageProvider(),
  ) {}
  static key(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    characters: Character[],
    model: string,
    route = "9router",
  ) {
    const previous = continuousPredecessor(version, segment);
    const inherited = previous && version.frames[previous.id]?.generated;
    return signature({
      source: analysis.sourceHash,
      segment: {
        start: segment.start,
        end: segment.end,
        shot: (() => {
          const shot = analysis.shots.find((s) => s.id === segment.shotId);
          return (
            shot && {
              description: shot.description,
              camera: shot.camera,
              lighting: shot.lighting,
            }
          );
        })(),
      },
      cast: characters
        .filter((c) => Object.values(version.mappings).includes(c.id))
        .map((c) => ({
          id: c.id,
          description: c.description,
          style: c.visualStyle,
          references: c.references,
        })),
      mappings: version.mappings,
      model,
      route,
      boundary: inherited
        ? {
            segmentId: previous!.id,
            signature: inherited.signature,
            asset: inherited.last,
          }
        : undefined,
    });
  }
  static async originalFrame(analysis: Analysis, time: number) {
    const timestamp = Number(time.toFixed(6));
    const id = `source-pose-${signature({ source: analysis.sourceHash, timestamp })}`;
    const cached = await cacheGet<{ asset: string }>(id);
    if (cached && (await assetExists(cached.asset))) return cached.asset;
    const frame = await newAsset("png");
    await extractSourceFrame(
      assetPath(analysis.sourceAsset),
      frame.path,
      timestamp,
    );
    await saveRecord("cache", { id, asset: frame.asset });
    return frame.asset;
  }
  static async extract(analysis: Analysis, segment: Segment): Promise<Frames> {
    const beats = (
      analysis.shots.find((s) => s.id === segment.shotId)?.motionBeats || []
    )
      .filter(
        (b) =>
          b.importance === "KEY" &&
          b.anchorTime >= segment.start &&
          b.anchorTime < segment.end,
      )
      .sort(
        (a, b) =>
          Number(b.phase === "ACTION" || b.phase === "REACTION") -
          Number(a.phase === "ACTION" || a.phase === "REACTION"),
      )
      .slice(0, 3)
      .sort((a, b) => a.anchorTime - b.anchorTime);
    const key = `frames-${signature({ source: analysis.sourceHash, start: segment.start, end: segment.end, moments: beats.map((b) => [b.id, b.anchorTime, b.action]), version: 2 })}`;
    const cached = await cacheGet<Frames>(key);
    if (
      cached &&
      (await assetExists(cached.first)) &&
      (await assetExists(cached.last)) &&
      (
        await Promise.all(
          (cached.moments || []).map((m) => assetExists(m.asset)),
        )
      ).every(Boolean)
    )
      return cached;
    const shot = analysis.shots.find((s) => s.id === segment.shotId)!;
    // Internal continuous-shot boundaries share the exact same source pose. At a hard cut, stay on this side of the cut.
    const endTime =
      segment.end < shot.end - 0.001
        ? segment.end
        : Math.max(segment.start, segment.end - 1 / (analysis.media.fps || 24));
    const first = await this.originalFrame(analysis, segment.start);
    const last = await this.originalFrame(analysis, endTime);
    const moments = [];
    for (const beat of beats)
      moments.push({
        beatId: beat.id,
        time: beat.anchorTime,
        action: beat.action,
        asset: await MotionAnalysisService.frame(
          analysis.sourceHash,
          analysis.sourceAsset,
          beat.anchorTime,
        ),
      });
    const frames: Frames = {
      first,
      last,
      ...(moments.length ? { moments } : {}),
    };
    await saveRecord("cache", { id: key, ...frames });
    return frames;
  }
  async generate(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    frames: Frames,
    characters: Character[],
    model: string,
    connection: RouterConnection,
  ): Promise<Frames> {
    if (!model.trim())
      throw new Error("Select an image model exposed by 9router.");
    const cast = analysis.speakers.flatMap((s) => {
      const character = characters.find((c) => c.id === version.mappings[s.id]);
      return character ? [{ speaker: s, character }] : [];
    });
    if (!cast.length)
      throw new Error("Map at least one original actor to a character first.");
    const key = KeyframeService.key(
      analysis,
      version,
      segment,
      characters,
      model,
      routerBaseUrl(connection.baseUrl),
    );
    const previous = continuousPredecessor(version, segment);
    const previousFrames = previous && version.frames[previous.id];
    const inherited =
      previous &&
      previousFrames?.generated &&
      previousFrames.last === frames.first &&
      referenceLinkCurrent(version, previous) &&
      previousFrames.generated.signature ===
        KeyframeService.key(
          analysis,
          version,
          previous,
          characters,
          model,
          routerBaseUrl(connection.baseUrl),
        ) &&
      (await assetExists(previousFrames.generated.last))
        ? {
            segmentId: previous.id,
            signature: previousFrames.generated.signature,
            asset: previousFrames.generated.last,
          }
        : undefined;
    const cached = await cacheGet<NonNullable<Frames["generated"]>>(
      `images-${key}`,
    );
    if (
      cached &&
      (await assetExists(cached.first)) &&
      (await assetExists(cached.last)) &&
      cached.inheritedFrom?.asset === inherited?.asset &&
      cached.inheritedFrom?.signature === inherited?.signature
    )
      return {
        ...frames,
        generated: {
          first: cached.first,
          last: cached.last,
          signature: cached.signature,
          inheritedFrom: cached.inheritedFrom,
        },
      };
    const references = cast
      .flatMap(({ speaker, character }) =>
        character.references.slice(0, 3).map((asset) => ({
          asset,
          description: `Identity reference for ${character.name}, replacing ${speaker.name} (${speaker.description}).`,
        })),
      )
      .slice(0, 12);
    const shot = analysis.shots.find((s) => s.id === segment.shotId)!;
    const prompt = `Replace only the mapped actors in this source frame. Preserve source composition, body pose, gestures, camera angle, clothing where relevant, background and lighting. ${cast.map(({ speaker, character }) => `${speaker.name} (${speaker.description}) becomes ${character.name}: ${character.description}; style ${character.visualStyle}.`).join(" ")} Shot: ${shot.description}. ${shot.camera}. ${shot.lighting}. Return the replacement frame as an image, no text or collage.`;
    // Sequential calls keep rate and cost easy to understand; each endpoint is independently cached.
    const outputs: string[] = [];
    for (const source of [frames.first, frames.last]) {
      if (source === frames.first && outputs.length === 0 && inherited) {
        outputs.push(inherited.asset);
        continue;
      }
      const endpointKey = `image-${signature({ key, source })}`;
      const endpoint = await cacheGet<{ asset: string }>(endpointKey);
      const asset =
        endpoint && (await assetExists(endpoint.asset))
          ? endpoint.asset
          : await this.provider.replace({
              source,
              references,
              prompt,
              model,
              connection,
            });
      await saveRecord("cache", { id: endpointKey, asset });
      outputs.push(asset);
    }
    const generated = {
      first: outputs[0],
      last: outputs[1],
      signature: key,
      inheritedFrom: inherited,
    };
    await saveRecord("cache", { id: `images-${key}`, ...generated });
    return { ...frames, generated };
  }
}
