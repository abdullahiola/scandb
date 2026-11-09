import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel needs the default output; the Docker image sets NEXT_OUTPUT_STANDALONE=1
  // at build time to get the self-contained server bundle its Dockerfile copies.
  ...(process.env.NEXT_OUTPUT_STANDALONE ? { output: "standalone" as const } : {}),
  serverExternalPackages: ['tesseract.js', 'pdf-parse'],
  turbopack: {},
};

export default nextConfig;
