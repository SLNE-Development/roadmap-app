import { describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import type { HistoryEntry } from "@/lib/ops/activity";
import type { AdrSummary } from "@/lib/ops/adrs";
import { writeSpec } from "@/lib/ops/documents";
import type { SystemOverview } from "@/lib/ops/overview";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { briefActivity, briefAdrs, briefOverview } from "./brief";
import { TOOLS } from "./definitions";
import { runTool } from "./registry";
import { handleRest } from "./rest";

const doc = (body: string) => ({
  kind: "spec" as const,
  version: 2,
  body,
  createdAt: new Date("2026-01-01"),
  versions: [1, 2],
  author: "Claude (for Ann)",
  authorName: "Ann",
  agent: "Claude",
});

const overview = (over: Partial<SystemOverview>) => ({ spec: null, plan: null, updates: [], questions: [], ...over }) as unknown as SystemOverview;

/** Creates system `x` through the create_system tool. */
async function createX(db: Db, actor: Actor, slug: string) {
  const create = TOOLS.find((t) => t.name === "create_system")!;
  await runTool(db, actor, create, { project: slug, slug: "x", title: "X" });
}

describe("briefOverview", () => {
  it("replaces bodies by metadata and counts characters", () => {
    const r = briefOverview(overview({ spec: doc("x".repeat(5000)) }));
    expect(r.spec).toEqual({ version: 2, createdAt: new Date("2026-01-01"), authorName: "Ann", agent: "Claude", chars: 5000 });
    expect(r.spec).not.toHaveProperty("body");
  });

  it("keeps a missing plan null", () => {
    expect(briefOverview(overview({})).plan).toBeNull();
  });

  it("keeps the 3 newest updates in order, reduced to their summary", () => {
    const updates = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      createdAt: new Date(2026, 0, 10 - i),
      authorName: "Ann",
      agent: null,
      summary: `s${i}`,
      nextStep: "n",
    }));
    const r = briefOverview(overview({ updates: updates as never }));
    expect(r.updates).toEqual([0, 1, 2].map((i) => ({ id: `u${i}`, createdAt: updates[i].createdAt, authorName: "Ann", agent: null, summary: `s${i}` })));
  });
});

describe("briefAdrs", () => {
  it("reduces each row", () => {
    const row = { number: 3, title: "T", status: "accepted", systems: ["a"], supersededBy: null, createdAt: new Date(), supersedes: null } as unknown as AdrSummary;
    expect(briefAdrs([row])).toEqual([{ number: 3, title: "T", status: "accepted", systems: ["a"], supersededBy: null }]);
  });
});

describe("briefActivity", () => {
  it("truncates long values to 120 characters plus an ellipsis", () => {
    const rows = [
      { id: 1, oldValue: null, newValue: "y".repeat(300) },
      { id: 2, oldValue: "a", newValue: "z".repeat(50) },
    ] as unknown as HistoryEntry[];
    const [long, short] = briefActivity(rows);
    expect(long.newValue).toHaveLength(121);
    expect(long.newValue?.endsWith("…")).toBe(true);
    expect(long.oldValue).toBeNull();
    expect(short.newValue).toBe("z".repeat(50));
  });
});

describe("get_system brief", () => {
  const def = TOOLS.find((t) => t.name === "get_system")!;

  it("is brief by default and full with brief false", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createX(db, owner, slug);
    await writeSpec(db, owner, slug, "x", { body: "# Spec body" });
    const brief = (await runTool(db, owner, def, { project: slug, system: "x" })) as { spec: Record<string, unknown> };
    expect(brief.spec).not.toHaveProperty("body");
    expect(brief.spec.chars).toBe(11);
    const full = (await runTool(db, owner, def, { project: slug, system: "x", brief: false })) as { spec: { body: string } };
    expect(full.spec.body).toBe("# Spec body");
  });

  it("coerces ?brief=false over REST", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createX(db, owner, slug);
    await writeSpec(db, owner, slug, "x", { body: "# Spec body" });
    const request = new Request(`http://test/api/v1/projects/${slug}/systems/x?brief=false`);
    const response = await handleRest(request, ["projects", slug, "systems", "x"], { db, resolveActor: async () => owner });
    expect(((await response.json()) as { spec: { body: string } }).spec.body).toBe("# Spec body");
  });
});
