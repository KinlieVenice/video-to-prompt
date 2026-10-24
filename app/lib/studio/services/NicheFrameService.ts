import type { Analysis, Character, Frames, Segment, Version } from "../types";
import type { RouterConnection } from "../connection";
import { assetExists, cacheGet, saveRecord, signature } from "../server/store";
import { routerBaseUrl } from "../server/openai";
import { OpenAIImageProvider } from "./KeyframeService";
import { expressionInstructions } from "../visualDirection";

export class NicheFrameService {
  constructor(
    private provider: Pick<
      OpenAIImageProvider,
      "create"
    > = new OpenAIImageProvider(),
  ) {}
  async generate(
    analysis: Analysis,
    version: Version,
    segment: Segment,
    characters: Character[],
    model: string,
    connection: RouterConnection,
  ): Promise<Frames> {
    const sceneIndex = analysis.shots.findIndex((s) => s.id === segment.shotId);
    const scene = analysis.contentPlan?.scenes[sceneIndex];
    if (analysis.origin !== "PLANNED" || !scene)
      throw new Error("Missing generated scene plan.");
    const character = characters.find((c) => c.id === version.mappings.main);
    if (!character) throw new Error("The niche character no longer exists.");
    const key = signature({
      scene,
      artStyle: analysis.contentPlan?.artStyle || character.visualStyle,
      character: {
        id: character.id,
        description: character.description,
        style: character.visualStyle,
        refs: character.references,
      },
      visualDirection: version.visualDirection,
      aspect: version.aspect,
      model,
      route: routerBaseUrl(connection.baseUrl),
      version: 1,
    });
    const outputs: string[] = [];
    for (const [index, description] of [
      scene.firstFrame,
      scene.lastFrame,
    ].entries()) {
      const endpoint = `niche-frame-${signature({ key, index, first: index === 1 ? outputs[0] : undefined })}`;
      const cached = await cacheGet<{ asset: string }>(endpoint);
      if (cached && (await assetExists(cached.asset))) {
        outputs.push(cached.asset);
        continue;
      }
      const references = character.references.slice(0, 3).map((asset) => ({
        asset,
        description: `Identity reference for ${character.name}. Preserve this character's identity; compose the NEW scene described in the prompt.`,
      }));
      if (index === 1)
        references.push({
          asset: outputs[0],
          description:
            "Generated first frame of this same scene. Preserve its character, background, props, camera, clothing and lighting; advance only the specified action.",
        });
      const asset = await this.provider.create({
        references,
        model,
        connection,
        prompt: `Create one complete ${version.aspect} frame for an ORIGINAL planned video. Character: ${character.name}: ${character.description}. Art style: ${analysis.contentPlan?.artStyle || character.visualStyle}. Preserve identity from the character references; render them in this art style instead of copying a conflicting rendering style. Scene: ${scene.description}. ${index === 0 ? "Opening pose" : "Final pose"}: ${description}. Camera: ${scene.camera}. Lighting: ${scene.lighting}. ${expressionInstructions(version)} ${version.visualDirection?.backgroundMode === "NEW" ? `Use this environment instead of any conflicting setting: ${version.visualDirection.backgroundPrompt}.` : "Use the planned environment, not the background in character identity references."} Fully compose the chosen aspect ratio: extend scene geometry naturally into the full canvas, no artificial black bars, no cropped character, no text, captions, collage or watermark.`,
      });
      await saveRecord("cache", { id: endpoint, asset });
      outputs.push(asset);
    }
    return {
      first: outputs[0],
      last: outputs[1],
      generated: { first: outputs[0], last: outputs[1], signature: key },
    };
  }
}
