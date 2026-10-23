import { readFile } from "node:fs/promises";
import type { AudioTake, Character, Turn, VoiceProfile } from "../types";
import { speechInput, TTS_MODELS } from "../types";
import {
  assetExists,
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
  writeAsset,
} from "../server/store";
import { blocks, googleRequest, type Interaction } from "../server/google";
import { probe, run } from "../server/ffmpeg";

export class VoiceService {
  static key(turn: Turn, voice: VoiceProfile) {
    // Timing does not affect the generated words or voice; alignment is applied at assembly.
    return signature(speechInput(turn, voice));
  }
  static async generate(
    turn: Turn,
    character: Character,
    apiKey: string,
    regenerate = false,
  ): Promise<AudioTake> {
    const voice = character.voice;
    if (!TTS_MODELS.includes(voice.model))
      throw new Error("Choose a supported Gemini TTS model.");
    if (!turn.text.trim()) throw new Error("This turn has no dialogue.");
    const key = this.key(turn, voice);
    const cached = await cacheGet<AudioTake>(`tts-${key}`);
    if (!regenerate && cached && (await assetExists(cached.asset)))
      return {
        asset: cached.asset,
        duration: cached.duration,
        signature: cached.signature,
        createdAt: cached.createdAt,
        inputFingerprint: cached.inputFingerprint,
      };
    const language =
      voice.language === "fil-PH"
        ? "Filipino; preserve any English code-switching"
        : voice.language === "en-US"
          ? "English; preserve any Filipino code-switching"
          : "Match the transcript language, including Filipino, English and Taglish";
    const response = await googleRequest<Interaction>("interactions", apiKey, {
      model: voice.model,
      store: false,
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text: turn.text,
              annotations: [
                {
                  type: "speech_metadata",
                  style: [voice.style, turn.emotion, language]
                    .filter(Boolean)
                    .join(". "),
                },
              ],
            },
          ],
        },
      ],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: voice.voiceId }] },
    });
    const audio = blocks(response)
      .filter((b) => b.type === "audio" && b.data)
      .at(-1);
    if (!audio?.data)
      throw new Error(
        "Gemini returned no audio. The provider may have rejected this line.",
      );
    const mime = audio.mime_type || "audio/wav";
    if (!mime.includes("wav"))
      throw new Error(
        `Expected WAV from Gemini TTS, received ${mime}. No malformed audio was saved.`,
      );
    const asset = await writeAsset(Buffer.from(audio.data, "base64"), "wav");
    const media = await probe(assetPath(asset));
    const take: AudioTake = {
      asset,
      duration: media.duration,
      signature: key,
      createdAt: new Date().toISOString(),
      inputFingerprint: JSON.stringify(speechInput(turn, voice)),
    };
    await saveRecord("cache", { id: `tts-${key}`, ...take });
    return take;
  }
  static async design(
    character: Character,
    apiKey: string,
  ): Promise<Character> {
    if (!character.voice.designPrompt.trim())
      throw new Error("Describe the voice before designing it.");
    const response = await googleRequest<{
      id?: string;
      sample_audio?: { data?: string; mime_type?: string };
    }>("voices", apiKey, {
      store: true,
      voice: {
        model: character.voice.model,
        type: "prompted",
        display_name: character.name,
        language_code:
          character.voice.language === "auto"
            ? "fil-PH"
            : character.voice.language,
        prompted: { input: character.voice.designPrompt },
      },
    });
    if (!response.id)
      throw new Error("Voice design returned no persistent voice ID.");
    const previewAsset = response.sample_audio?.data
      ? await writeAsset(
          Buffer.from(response.sample_audio.data, "base64"),
          "wav",
        )
      : undefined;
    return {
      ...character,
      voice: {
        ...character.voice,
        kind: "DESIGNED",
        voiceId: response.id,
        previewAsset,
      },
    };
  }
  static async extractOriginal(sourceAsset: string) {
    const key = `original-${signature(sourceAsset)}`;
    const cached = await cacheGet<{ asset: string }>(key);
    if (cached && (await assetExists(cached.asset))) return cached.asset;
    const audio = await newAsset("wav");
    await run("ffmpeg", [
      "-y",
      "-i",
      assetPath(sourceAsset),
      "-vn",
      "-c:a",
      "pcm_s16le",
      audio.path,
    ]);
    await saveRecord("cache", { id: key, asset: audio.asset });
    return audio.asset;
  }
  static async audioBytes(asset: string) {
    return readFile(assetPath(asset));
  }
}
