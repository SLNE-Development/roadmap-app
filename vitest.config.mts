import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Vitest configuration: Node environment, the `@/` alias, and an inert `server-only`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
