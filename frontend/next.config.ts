import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Produces a minimal self-contained server at .next/standalone for Docker.
  output: "standalone",
};

export default withNextIntl(nextConfig);
