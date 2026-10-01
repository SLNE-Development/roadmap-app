import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { ChangeEvent } from "@/worker/feed";
import { FALLBACK_KEYS, INVALIDATION_KEYS, invalidationKeys, realtimeChannel } from "./keys";

/** Copied from `grep -rhoE 'entity: "[a-z_-]+"' src/lib/ops | sort -u`. */
const ENTITIES = [
  "adr", "board", "check", "column", "dependency", "document", "domain", "field", "glossary", "member", "page",
  "phase", "planning", "project", "question", "release", "repo", "system", "task", "update", "webhook",
  "code",
];

function event(entity: string, projectId: string): ChangeEvent {
  return { id: 1, projectId, systemId: null, entity, entityId: "x", field: "f", oldValue: null, newValue: null } as unknown as ChangeEvent;
}

describe("invalidationKeys", () => {
  it("maps a task event to its sorted routers", () => {
    expect(invalidationKeys([event("task", "p1")])).toEqual(new Map([["p1", ["gates", "history", "insight", "projects", "requests", "systems"]]]));
  });

  it("unions keys per project", () => {
    const result = invalidationKeys([event("task", "p1"), event("adr", "p1"), event("member", "p2")]);
    expect(result.size).toBe(2);
    expect(result.get("p1")).toEqual(["adrs", "gates", "history", "insight", "projects", "requests", "systems"]);
    expect(result.get("p2")).toEqual(["members", "projects"]);
  });

  it("refreshes the rule chips (gates) on entities that feed gate rules", () => {
    for (const name of ["task", "check", "question", "adr", "document", "update", "system", "board", "column"]) {
      expect(INVALIDATION_KEYS[name], name).toContain("gates");
    }
  });

  it("falls back for an unknown entity", () => {
    expect(invalidationKeys([event("zzz", "p1")]).get("p1")).toEqual([...FALLBACK_KEYS].sort());
  });

  it("returns an empty map for no events", () => {
    expect(invalidationKeys([]).size).toBe(0);
  });

  it("has a row for every entity", () => {
    for (const name of ENTITIES) expect(INVALIDATION_KEYS[name], name).toBeDefined();
  });

  it("only names routers of appRouter", () => {
    const routers = appRouter._def.record;
    for (const [entity, keys] of Object.entries(INVALIDATION_KEYS)) {
      for (const key of [...keys, ...FALLBACK_KEYS]) expect(key in routers, `${entity}: ${key}`).toBe(true);
    }
  });

  it("names the channel after the project", () => {
    expect(realtimeChannel("p1")).toBe("project:p1");
  });
});
