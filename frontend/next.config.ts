import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel needs the default output; the Docker image sets NEXT_OUTPUT_STANDALONE=1
  // at build time to get the self-contained server bundle its Dockerfile copies.
  ...(process.env.NEXT_OUTPUT_STANDALONE ? { output: "standalone" as const } : {}),
  // sql.js loads its .wasm from its own package dir at runtime, so it must not be bundled
  serverExternalPackages: ['tesseract.js', 'pdf-parse', 'sql.js'],
  outputFileTracingIncludes: {
    '/api/export': ['./node_modules/sql.js/dist/sql-wasm.wasm'],
  },
  turbopack: {},
};

export default nextConfig;
