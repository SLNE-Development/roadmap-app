import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { testDeps } from "./deps";
import { registerJob, registerRepeatable, registeredRepeatables, runJob } from "./jobs";

describe("job registry", () => {
  it("runs the registered handler with the job data", async () => {
    const seen: unknown[] = [];
    registerJob("maintenance", "ping", async (data) => {
      seen.push(data);
    });
    await runJob("maintenance", "ping", { x: 1 }, testDeps(await createTestDb()));
    expect(seen).toEqual([{ x: 1 }]);
  });

  it("rejects an unknown job", async () => {
    await expect(runJob("maintenance", "nope", {}, testDeps(await createTestDb()))).rejects.toThrow(
      "No handler for job maintenance/nope",
    );
  });

  it("refuses a duplicate registration", () => {
    registerJob("maintenance", "dup", async () => {});
    expect(() => registerJob("maintenance", "dup", async () => {})).toThrow(
      "Job maintenance/dup is already registered",
    );
  });

  it("lists registered repeatables with their schedule", () => {
    registerJob("maintenance", "tick", async () => {});
    registerRepeatable("maintenance", "tick", { everyMs: 60_000 }, { a: 1 });
    expect(registeredRepeatables()).toContainEqual({
      queue: "maintenance",
      jobName: "tick",
      schedule: { everyMs: 60_000 },
      data: { a: 1 },
    });
  });
});
