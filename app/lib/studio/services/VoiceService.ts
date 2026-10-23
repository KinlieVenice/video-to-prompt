import { readFile } from "node:fs/promises";
import type { AudioTake, Character, Turn, VoiceProfile } from "../types";
import { speechInput } from "../types";
import {
  assetExists,
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
  writeAsset,
} from "../server/store";
import type { RouterConnection } from "../connection";
import { routerBaseUrl, routerRequest } from "../server/openai";
import { probe, run } from "../server/ffmpeg";

export class VoiceService {
  static key(turn: Turn, voice: VoiceProfile) {
    // Timing does not affect the generated words or voice; alignment is applied at assembly.
    return signature(speechInput(turn, voice));
  }
  static async generate(
    turn: Turn,
    character: Character,
    connection: RouterConnection,
    regenerate = false,
  ): Promise<AudioTake> {
    const voice = character.voice;
    if (voice.provider !== "OPENAI")
      throw new Error(
        "This saved voice belongs to Gemini. Select an OpenAI voice in the character editor; existing audio remains reusable.",
      );
    if (!connection.ttsEnabled)
      throw new Error(
        "Enable the optional speech route in Settings after configuring a TTS provider in 9router. ORIGINAL audio needs no TTS.",
      );
    if (!turn.text.trim()) throw new Error("This turn has no dialogue.");
    const key = this.key(turn, voice);
    const cacheId = `tts-router-${signature({ key, route: routerBaseUrl(connection.baseUrl) })}`;
    const cached = await cacheGet<AudioTake>(cacheId);
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
    const instructions = [
      "Speak the input verbatim without translation or censorship.",
      voice.style,
      turn.emotion,
      language,
    ]
      .filter(Boolean)
      .join(". ");
    const response = await routerRequest(connection, "audio/speech", {
      model: `${voice.model}/${voice.voiceId}`,
      voice: voice.voiceId,
      input: turn.text,
      instructions,
      style: instructions,
      language: voice.language === "auto" ? "" : voice.language,
      response_format: "wav",
    });
    const mime = response.headers.get("content-type") || "";
    if (!mime.startsWith("audio/") && mime !== "application/octet-stream")
      throw new Error(
        "9router returned no binary speech audio. Check its TTS route.",
      );
    // 9router may return MP3 even when WAV was requested. Normalize actual audio with FFmpeg.
    const raw = await writeAsset(
      Buffer.from(await response.arrayBuffer()),
      mime.includes("wav") ? "wav" : "mp3",
    );
    const wav = await newAsset("wav");
    await run("ffmpeg", [
      "-y",
      "-i",
      assetPath(raw),
      "-vn",
      "-c:a",
      "pcm_s16le",
      wav.path,
    ]);
    const asset = wav.asset;
    const media = await probe(assetPath(asset));
    const take: AudioTake = {
      asset,
      duration: media.duration,
      signature: key,
      createdAt: new Date().toISOString(),
      inputFingerprint: JSON.stringify(speechInput(turn, voice)),
    };
    await saveRecord("cache", { id: cacheId, ...take });
    return take;
  }
  static async design(): Promise<Character> {
    throw new Error(
      "Voice design is not supported by the 9router speech adapter. Save a supported prebuilt voice instead.",
    );
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
