import type { NextConfig } from "next";

/** Next.js configuration: standalone output for the Docker image. */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
