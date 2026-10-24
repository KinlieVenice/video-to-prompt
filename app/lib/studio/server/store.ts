import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { Analysis, Character, Project, StudioState } from "../types";

export const root = () =>
  path.resolve(
    /* turbopackIgnore: true */
    process.env.STUDIO_DATA_DIR || path.join(process.cwd(), ".studio"),
  );
type Collection =
  "analyses" | "characters" | "projects" | "cache" | "flow-jobs";
export function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid record ID.");
  return id;
}
export function assetPath(asset: string) {
  if (
    !/^[a-f0-9-]{36}\.(mp4|mov|wav|flac|mp3|m4a|ogg|png|jpg|webp|json|srt|zip)$/.test(
      asset,
    )
  )
    throw new Error("Invalid asset ID.");
  return path.join(root(), "assets", asset);
}
export async function saveRecord<T extends { id: string }>(
  collection: Collection,
  record: T,
) {
  const dir = path.join(/* turbopackIgnore: true */ root(), collection);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${validId(record.id)}.json`);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(record, null, 2));
  await rename(temp, target);
  return record;
}
export async function getRecord<T>(
  collection: Collection,
  id: string,
): Promise<T> {
  return JSON.parse(
    await readFile(
      path.join(root(), collection, `${validId(id)}.json`),
      "utf8",
    ),
  );
}
export async function listRecords<T>(collection: Collection): Promise<T[]> {
  const dir = path.join(/* turbopackIgnore: true */ root(), collection);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(/* turbopackIgnore: true */ dir)).filter((f) =>
    f.endsWith(".json"),
  );
  return Promise.all(
    files.map(async (f) =>
      JSON.parse(
        await readFile(
          /* turbopackIgnore: true */ path.join(
            /* turbopackIgnore: true */ dir,
            f,
          ),
          "utf8",
        ),
      ),
    ),
  );
}
export async function state(): Promise<StudioState> {
  const [projects, analyses, characters] = await Promise.all([
    listRecords<Project>("projects"),
    listRecords<Analysis>("analyses"),
    listRecords<Character>("characters"),
  ]);
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    analyses,
    characters,
  };
}
export async function newAsset(ext: string) {
  await mkdir(path.join(root(), "assets"), { recursive: true });
  const asset = `${randomUUID()}.${ext}`;
  return { asset, path: assetPath(asset) };
}
export async function writeAsset(data: Buffer | string, ext: string) {
  const output = await newAsset(ext);
  await writeFile(output.path, data);
  return output.asset;
}
export const signature = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function cacheGet<T>(id: string): Promise<T | undefined> {
  try {
    return await getRecord<T>("cache", id);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export async function assetExists(asset: string) {
  try {
    await stat(assetPath(asset));
    return true;
  } catch {
    return false;
  }
}

// One local server process: serialize read/modify/write operations, including paid work.
const globalStore = globalThis as typeof globalThis & {
  studioQueue?: Promise<unknown>;
};
export async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = (globalStore.studioQueue || Promise.resolve()).then(work, work);
  globalStore.studioQueue = next.catch(() => undefined);
  return next;
}
