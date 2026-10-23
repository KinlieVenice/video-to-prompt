import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  outputFileTracingExcludes: {
    "/*": ["./.studio/**/*", "./.tmp/**/*", "./.studio-test-*/**/*"],
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
