import { readFile } from "node:fs/promises";
import type { Analysis, Character, Frames, Segment, Version } from "../types";
import { IMAGE_MODELS } from "../types";
import {
  assetExists,
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
  writeAsset,
} from "../server/store";
import { run } from "../server/ffmpeg";
import { blocks, googleRequest, type Interaction } from "../server/google";

export interface ImageGenerationProvider {
  replace(input: {
    source: string;
    references: { asset: string; description: string }[];
    prompt: string;
    model: string;
    apiKey: string;
  }): Promise<string>;
}
export class GeminiImageProvider implements ImageGenerationProvider {
  async replace(input: Parameters<ImageGenerationProvider["replace"]>[0]) {
    const image = async (asset: string) => ({
      type: "image",
      mime_type: asset.endsWith(".jpg")
        ? "image/jpeg"
        : asset.endsWith(".webp")
          ? "image/webp"
          : "image/png",
      data: (await readFile(assetPath(asset))).toString("base64"),
    });
    const content: unknown[] = [
      { type: "text", text: input.prompt },
      { type: "text", text: "Source composition frame:" },
      await image(input.source),
    ];
    for (const reference of input.references)
      content.push(
        { type: "text", text: reference.description },
        await image(reference.asset),
      );
    const response = await googleRequest<Interaction>(
      "interactions",
      input.apiKey,
      { model: input.model, store: false, input: content },
    );
    const output = blocks(response)
      .filter((b) => b.type === "image" && b.data)
      .at(-1);
    if (!output?.data)
      throw new Error("Image provider returned no reference image.");
    const mime = output.mime_type || "image/png";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
      throw new Error("Unsupported generated image format.");
    return writeAsset(
      Buffer.from(output.data, "base64"),
      mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png",
    );
  }
}
export class KeyframeService {
  constructor(
    private provider: ImageGenerationProvider = new GeminiImageProvider(),
  ) {}
  static key(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    characters: Character[],
    model: string,
  ) {
    return signature({
      source: analysis.sourceHash,
      segment: {
        start: segment.start,
        end: segment.end,
        shot: analysis.shots.find((s) => s.id === segment.shotId),
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
    });
  }
  static async extract(analysis: Analysis, segment: Segment): Promise<Frames> {
    const key = `frames-${signature({ source: analysis.sourceHash, start: segment.start, end: segment.end })}`;
    const cached = await cacheGet<Frames>(key);
    if (
      cached &&
      (await assetExists(cached.first)) &&
      (await assetExists(cached.last))
    )
      return cached;
    const first = await newAsset("png"),
      last = await newAsset("png");
    for (const [output, time] of [
      [first, segment.start],
      [
        last,
        Math.max(segment.start, segment.end - 1 / (analysis.media.fps || 24)),
      ],
    ] as const) {
      await run("ffmpeg", [
        "-y",
        "-ss",
        String(time),
        "-i",
        assetPath(analysis.sourceAsset),
        "-frames:v",
        "1",
        "-update",
        "1",
        output.path,
      ]);
    }
    const frames = { first: first.asset, last: last.asset };
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
    apiKey: string,
  ): Promise<Frames> {
    if (!IMAGE_MODELS.includes(model))
      throw new Error("Unsupported image model.");
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
    );
    const cached = await cacheGet<{
      first: string;
      last: string;
      signature: string;
    }>(`images-${key}`);
    if (
      cached &&
      (await assetExists(cached.first)) &&
      (await assetExists(cached.last))
    )
      return {
        ...frames,
        generated: {
          first: cached.first,
          last: cached.last,
          signature: cached.signature,
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
              apiKey,
            });
      await saveRecord("cache", { id: endpointKey, asset });
      outputs.push(asset);
    }
    const generated = { first: outputs[0], last: outputs[1], signature: key };
    await saveRecord("cache", { id: `images-${key}`, ...generated });
    return { ...frames, generated };
  }
}
