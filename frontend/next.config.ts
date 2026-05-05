import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove "standalone" for Vercel deployment
  // output: "standalone",
  serverExternalPackages: ['tesseract.js', 'pdf-parse'],
  turbopack: {},
};

export default nextConfig;
