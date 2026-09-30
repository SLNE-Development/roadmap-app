import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { testDeps } from "./deps";
import { beat, HEARTBEAT_FILE, HEARTBEAT_KEY } from "./heartbeat";

describe("beat", () => {
  it("writes the time to the heartbeat file and to the kv store", async () => {
    const deps = testDeps(await createTestDb(), { now: () => new Date("2026-10-01T10:00:00Z") });
    const writes: [string, string][] = [];
    await beat(deps, async (path, data) => {
      writes.push([path, data]);
    });
    expect(writes).toEqual([[HEARTBEAT_FILE, "2026-10-01T10:00:00.000Z"]]);
    expect(await deps.kv.get(HEARTBEAT_KEY)).toBe("2026-10-01T10:00:00.000Z");
  });
});
