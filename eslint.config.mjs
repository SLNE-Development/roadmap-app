import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

/** ESLint flat config: Next.js core web vitals and TypeScript rules. */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "drizzle/**",
    "plugin/**",
    "src/components/ui/**",
    "src/hooks/**",
  ]),
]);
