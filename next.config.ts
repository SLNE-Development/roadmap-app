import type { NextConfig } from "next";

/**
 * Next.js configuration: standalone output for the Docker image, no generated agent files.
 * BullMQ reads its command scripts from its package directory at runtime, so it stays
 * external and its dist is forced into the traced standalone output.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bullmq", "ioredis"],
  outputFileTracingIncludes: { "/**": ["./node_modules/bullmq/dist/**"] },
  agentRules: false,
};

export default nextConfig;
