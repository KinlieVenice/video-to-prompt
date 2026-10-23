import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { assetPath } from "../../../lib/studio/server/store";
import { localRequest } from "../../../lib/studio/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const types: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  wav: "audio/wav",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
  srt: "application/x-subrip",
  zip: "application/zip",
};
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  try {
    localRequest(request);
    const { asset } = await params;
    const file = assetPath(asset);
    const { size } = await stat(file);
    let start = 0,
      end = size - 1;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else start = Number(match[1]);
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
      if (start > end || start >= size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
    }
    const handle = await open(file, "r");
    const stream = Readable.toWeb(
      handle.createReadStream({ start, end, autoClose: true }),
    ) as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      "Content-Type":
        types[asset.split(".").at(-1)!] || "application/octet-stream",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
}
