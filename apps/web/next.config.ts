import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@skillforge/core"],
  devIndicators: false,
  // pnpm build runs the complete typecheck before Next, avoiding simultaneous compiler heaps.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    cpus: 1,
    webpackBuildWorker: false,
    webpackMemoryOptimizations: true,
  },
};
export default config;
