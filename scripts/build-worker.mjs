import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/** Resolves `server-only` to an empty module and the `@/` alias to `src/`, and leaves every other package external. */
const workerPlugin = {
  name: "worker-resolve",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    b.onResolve({ filter: /^@\// }, (args) =>
      b.resolve(`./${path.posix.join("src", args.path.slice(2))}`, { resolveDir: process.cwd(), kind: args.kind }),
    );
    b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
  },
};

await build({
  entryPoints: ["src/worker/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/worker/worker.mjs",
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
  resolveExtensions: [".ts", ".js", ".mjs", ".json"],
  plugins: [workerPlugin],
});

mkdirSync("dist/worker", { recursive: true });
copyFileSync("src/worker/healthcheck.mjs", "dist/worker/healthcheck.mjs");
