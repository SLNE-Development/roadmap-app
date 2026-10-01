import type { NextConfig } from "next";

/**
 * Next.js configuration: standalone output for the Docker image, no generated agent files.
 * BullMQ reads its command scripts from its package directory at runtime, so it stays
 * external and its dist is forced into the traced standalone output. Browsers always re-check the
 * service worker script, so a new version reaches them on the next visit.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bullmq", "ioredis"],
  outputFileTracingIncludes: { "/**": ["./node_modules/bullmq/dist/**"] },
  agentRules: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
