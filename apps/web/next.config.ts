import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted deployment — no Vercel-specific features (blueprint ADR-005 & §8)
  output: "standalone",
};

export default nextConfig;
