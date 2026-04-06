import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['tesseract.js', 'better-sqlite3', 'pdf-parse'],
  turbopack: {},
};

export default nextConfig;
