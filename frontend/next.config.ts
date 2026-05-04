import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['192.168.1.197'],
  serverExternalPackages: ['tesseract.js', 'pdf-parse'],
  turbopack: {},
};

export default nextConfig;
