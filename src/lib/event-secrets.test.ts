import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEventSecrets } from "@/lib/ops/event-settings";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { loadEventSecrets } from "./event-secrets";

const ROOT = path.resolve(__dirname, "../..");
const SECRETS_MODULE = path.join(ROOT, "src/lib/event-secrets.ts");

/** The files under `dir` that are not tests, as absolute paths. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/** The project files `file` imports (static, dynamic and re-exports), resolving `@/` and relative paths; packages are skipped. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return specs.flatMap((spec) => {
    const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
    if (!base) return [];
    const found = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find(existsSync);
    return found ? [found] : [];
  });
}

/** Every module reachable from `entries` through `imports`, the entries included. */
function reachable(entries: string[], imports: (file: string) => string[]): Set<string> {
  const seen = new Set(entries);
  const queue = [...entries];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const next of imports(file)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Existing web-path modules that decrypt other secrets (GitHub app credentials and webhook secrets, Part 6). They
 * decrypt their own values, never the event secrets; a new entry needs the same justification.
 */
const DECRYPT_ALLOWLIST = ["src/lib/crypto.ts", "src/lib/github/webhook.ts", "src/lib/ops/github-app.ts", "src/lib/ops/github-repos.ts"].map((f) => path.join(ROOT, f));

describe("import graph guard", () => {
  const entries = ["src/app", "src/server", "src/components"].flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
  const web = reachable(entries, importsOf);

  it("walks the real graph (positive controls)", () => {
    expect(entries.length).toBeGreaterThan(50);
    expect(web.has(path.join(ROOT, "src/lib/ops/event-settings.ts"))).toBe(true);
    expect(web.has(path.join(ROOT, "src/lib/crypto.ts"))).toBe(true);
  });

  it("finds a module reached through an intermediate one", () => {
    const graph: Record<string, string[]> = { router: ["op"], op: ["secrets"], secrets: [] };
    expect(reachable(["router"], (f) => graph[f] ?? []).has("secrets")).toBe(true);
    expect(reachable(["router"], (f) => (f === "op" ? [] : (graph[f] ?? []))).has("secrets")).toBe(false);
  });

  it("never reaches the event secrets module from the web", () => {
    expect(web.has(SECRETS_MODULE)).toBe(false);
  });

  it("never reaches decryptSecret outside the allowlist", () => {
    const offenders = [...web].filter((f) => !DECRYPT_ALLOWLIST.includes(f) && /\bdecryptSecret\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("keeps the event secret columns out of web modules other than their writer", () => {
    const writers = /ops[\\/]event-settings\.ts$|db[\\/]schema[\\/]events\.ts$/;
    const offenders = [...web].filter((f) => !writers.test(f) && /(public|team|staff)WebhookEnc|botTokenEnc/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("loadEventSecrets", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns nothing before any setting exists", async () => {
    const db = await createTestDb();
    expect(await loadEventSecrets(db)).toEqual({ publicWebhook: null, teamWebhook: null, staffWebhook: null, botToken: null });
  });

  it("decrypts what an admin stored", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const hook = "https://discord.com/api/webhooks/123456789/tok-en_abcd";
    await setEventSecrets(db, admin, { teamWebhook: hook });
    expect(await loadEventSecrets(db)).toMatchObject({ teamWebhook: hook, publicWebhook: null });
  });
});
