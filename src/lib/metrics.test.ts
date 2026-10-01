import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { changeLog, feedCursor } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { memoryKv } from "./kv";
import { registerBuiltinMetrics, renderMetrics, type Metric } from "./metrics";

describe("renderMetrics", () => {
  it("renders a gauge in Prometheus text format", async () => {
    const metric: Metric = {
      name: "roadmap_queue_jobs",
      help: "Jobs per queue and state.",
      type: "gauge",
      collect: async () => [{ labels: { queue: "deliver", state: "waiting" }, value: 3 }],
    };
    expect(await renderMetrics([metric])).toBe(
      [
        "# HELP roadmap_queue_jobs Jobs per queue and state.",
        "# TYPE roadmap_queue_jobs gauge",
        'roadmap_queue_jobs{queue="deliver",state="waiting"} 3',
        "",
      ].join("\n"),
    );
  });

  it("escapes label values", async () => {
    const metric: Metric = {
      name: "m",
      help: "h",
      type: "gauge",
      collect: async () => [{ labels: { v: 'a"b\\c\nd' }, value: 1 }],
    };
    expect(await renderMetrics([metric])).toContain('m{v="a\\"b\\\\c\\nd"} 1');
  });

  it("still renders the other metrics when a collector never settles", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hung: Metric = { name: "hung", help: "h", type: "gauge", collect: () => new Promise(() => {}) };
    const good: Metric = { name: "good", help: "g", type: "gauge", collect: async () => [{ value: 1 }] };
    const text = await renderMetrics([hung, good], 20);
    expect(text).toContain("# TYPE hung gauge");
    expect(text).not.toMatch(/^hung /m);
    expect(text).toContain("good 1");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("still renders the other metrics when a collector throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad: Metric = { name: "bad", help: "b", type: "gauge", collect: async () => Promise.reject(new Error("x")) };
    const good: Metric = { name: "good", help: "g", type: "counter", collect: async () => [{ value: 2 }] };
    const text = await renderMetrics([bad, good]);
    expect(text).toContain("# HELP bad b\n# TYPE bad gauge\n");
    expect(text).not.toMatch(/^bad /m);
    expect(text).toContain("good 2");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("built-in metrics", () => {
  it("reports the feed lag per consumer", async () => {
    const db = await createTestDb();
    const { projectId } = await createProjectFixture(db);
    for (let i = 0; i < 8; i++) {
      await db.insert(changeLog).values({ projectId, entity: "task", entityId: "t", field: "title" });
    }
    const [{ max }] = await db.select({ max: sql<number>`max(${changeLog.id})::int` }).from(changeLog);
    await db.insert(feedCursor).values({ name: "rec", lastId: max - 3 });
    const registered: Metric[] = [];
    registerBuiltinMetrics(
      { db, kv: memoryKv(), queueCounts: async () => ({}), pingValkey: async () => true },
      (m) => registered.push(m),
    );
    const text = await renderMetrics(registered);
    expect(text).toContain('roadmap_feed_lag{consumer="rec"} 3');
    expect(text).toContain(`roadmap_feed_cursor{consumer="rec"} ${max - 3}`);
    expect(text).toContain("roadmap_db_up 1");
  });
});
