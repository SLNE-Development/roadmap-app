import { describe, expect, it } from "vitest";
import { memoryQueue } from "./queue";

describe("memoryQueue", () => {
  it("records added jobs", async () => {
    const queue = memoryQueue();
    await queue.add("x", { a: 1 });
    expect(queue.jobs).toEqual([{ jobName: "x", data: { a: 1 }, opts: {} }]);
  });

  it("ignores a duplicate job id like BullMQ", async () => {
    const queue = memoryQueue();
    await queue.add("x", {}, { jobId: "chg-1-a" });
    await queue.add("x", {}, { jobId: "chg-1-a" });
    expect(queue.jobs).toHaveLength(1);
  });

  it("rejects job ids containing a colon", async () => {
    await expect(memoryQueue().add("x", {}, { jobId: "chg:1" })).rejects.toThrow("Job ids must not contain ':'");
  });

  it("rejects purely numeric job ids", async () => {
    await expect(memoryQueue().add("x", {}, { jobId: "42" })).rejects.toThrow("Job ids must not be purely numeric");
  });
});
