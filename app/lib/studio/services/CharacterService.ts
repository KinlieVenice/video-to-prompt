import type { Character } from "../types";
import { characterSchema } from "../validation";
import { assetExists, saveRecord } from "../server/store";

export class CharacterService {
  static async save(input: unknown): Promise<Character> {
    const character = characterSchema.parse(input);
    for (const asset of character.references)
      if (!/\.(png|jpg|webp)$/.test(asset) || !(await assetExists(asset)))
        throw new Error("A character reference image is missing.");
    return saveRecord("characters", {
      ...character,
      updatedAt: new Date().toISOString(),
    });
  }
}
