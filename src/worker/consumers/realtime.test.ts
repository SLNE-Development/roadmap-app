import { describe, expect, it, vi } from "vitest";
import { memoryBus } from "@/lib/bus";
import { memoryKv } from "@/lib/kv";
import { memoryQueue } from "@/lib/queue";
import type { Db } from "@/db/types";
import type { WorkerDeps } from "../deps";
import type { ChangeEvent } from "../feed";
import { handleRealtime } from "./realtime";

function event(entity: string, projectId: string): ChangeEvent {
  return { id: 1, projectId, systemId: null, entity, entityId: "x", field: "f", oldValue: null, newValue: null } as unknown as ChangeEvent;
}

function deps(bus = memoryBus()): WorkerDeps {
  return { db: {} as Db, kv: memoryKv(), queue: () => memoryQueue(), bus, now: () => new Date() };
}

describe("handleRealtime", () => {
  it("publishes one keys message per project", async () => {
    const bus = memoryBus();
    const p1: object[] = [];
    const p2: object[] = [];
    await bus.subscribe("project:p1", (m) => p1.push(m));
    await bus.subscribe("project:p2", (m) => p2.push(m));
    await handleRealtime([event("task", "p1"), event("adr", "p1"), event("member", "p2")], deps(bus));
    expect(p1).toEqual([{ keys: ["adrs", "gates", "history", "insight", "projects", "requests", "systems"] }]);
    expect(p2).toEqual([{ keys: ["members", "projects"] }]);
    expect(Object.keys(p1[0])).toEqual(["keys"]);
  });

  it("publishes nothing for no events", async () => {
    const bus = memoryBus();
    const publish = vi.spyOn(bus, "publish");
    await handleRealtime([], deps(bus));
    expect(publish).not.toHaveBeenCalled();
  });

  it("logs a publish failure instead of throwing", async () => {
    const bus = memoryBus();
    vi.spyOn(bus, "publish").mockRejectedValue(new Error("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleRealtime([event("task", "p1")], deps(bus))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
