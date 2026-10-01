import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { PRODUCER_OPTIONS } from "./valkey";

describe("producer client options", () => {
  it("fail fast while Valkey is unreachable", async () => {
    const client = new Redis("redis://localhost:1", { ...PRODUCER_OPTIONS, retryStrategy: () => 200 });
    client.on("error", () => {});
    const started = Date.now();
    try {
      await expect(client.get("k")).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      client.disconnect();
    }
  });
});
