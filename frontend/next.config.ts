import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal self-contained server at .next/standalone for Docker.
  output: "standalone",
};

export default nextConfig;
