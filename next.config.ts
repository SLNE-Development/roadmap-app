import type { NextConfig } from "next";

/** Next.js configuration: standalone output for the Docker image, no generated agent files. */
const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
};

export default nextConfig;
