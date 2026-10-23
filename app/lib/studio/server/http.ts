export function localRequest(request: Request) {
  const url = new URL(request.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (!loopback.includes(url.hostname))
    throw new Error("Studio API is available on localhost only.");
  // Next.js can normalize the internal URL to localhost even when the browser used 127.0.0.1.
  const host = request.headers.get("host") || url.host;
  const publicUrl = new URL(`${url.protocol}//${host}`);
  if (
    !loopback.includes(publicUrl.hostname) ||
    publicUrl.host !== host ||
    publicUrl.port !== url.port
  )
    throw new Error("Invalid local host.");
  const origin = request.headers.get("origin");
  if (origin && origin !== publicUrl.origin)
    throw new Error("Cross-origin requests are not allowed.");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Cross-site requests are not allowed.");
}
