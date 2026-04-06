import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ['tesseract.js', 'better-sqlite3', 'pdf-parse'],
  turbopack: {},
};

export default nextConfig;
