import Redis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testValkeyUrl, uniquePrefix } from "@/test/valkey";
import { valkeyBus } from "./bus";

const client = new Redis(testValkeyUrl(), { maxRetriesPerRequest: null });
const bus = valkeyBus({ client, prefix: uniquePrefix() });

afterAll(async () => {
  await client.quit();
});

describe("valkeyBus", () => {
  it("delivers a published message within a second and stops after unsubscribe", async () => {
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe("project:p1", handler);
    await bus.publish("project:p1", { keys: ["systems"] });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ keys: ["systems"] }), { timeout: 1000 });

    unsubscribe();
    await bus.publish("project:p1", { keys: ["again"] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("resolves concurrent subscribes on a new channel only once the subscription is active", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const [unsubA, unsubB] = await Promise.all([bus.subscribe("project:p2", a), bus.subscribe("project:p2", b)]);
    await bus.publish("project:p2", { n: 1 });
    await vi.waitFor(() => {
      expect(a).toHaveBeenCalledWith({ n: 1 });
      expect(b).toHaveBeenCalledWith({ n: 1 });
    }, { timeout: 1000 });
    unsubA();
    unsubB();
  });
});
