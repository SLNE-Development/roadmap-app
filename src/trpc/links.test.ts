import { createTRPCClient } from "@trpc/client";
import { describe, expect, it } from "vitest";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/router";
import { makeLinks } from "./links";

/** A fetch that records the request and answers every batched call with an empty result. */
function recordingFetch() {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const count = new URL(url, "http://x").searchParams.get("input") ? Object.keys(JSON.parse(new URL(url, "http://x").searchParams.get("input")!)).length : 1;
    const result = { result: { data: superjson.serialize({ parts: [], embeds: [] }) } };
    return new Response(JSON.stringify(Array.from({ length: count }, () => result)), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("makeLinks", () => {
  it("sends a 30,000 character draft preview in a POST body, not in the URL", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createTRPCClient<AppRouter>({ links: makeLinks("http://x/api/trpc", fetchImpl) });
    const text = "ä ".repeat(15_000);
    await client.requests.posts.preview.query({ id: "00000000-0000-4000-8000-000000000000", kind: "team", text });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.length).toBeLessThan(200);
    expect(calls[0].body).toContain("ä ä ä");
  });

  it("keeps other queries as GET", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createTRPCClient<AppRouter>({ links: makeLinks("http://x/api/trpc", fetchImpl) });
    await client.requests.settings.get.query();
    expect(calls[0].method).toBe("GET");
  });
});
