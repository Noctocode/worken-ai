import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: "../..",
  turbopack: {
    root: "../..",
  },
};

export default nextConfig;
