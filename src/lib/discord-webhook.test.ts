import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteMessage, editMessage, sendMessage, type DiscordBody, type Webhook } from "./discord-webhook";

const MARKER = "SECRETMARKER123";
const hook: Webhook = { kind: "team", url: `https://discord.com/api/webhooks/111111111111111111/${MARKER}` };
const body: DiscordBody = { content: "Hallo", username: "Event-Team", allowed_mentions: { parse: [] } };

/** Stubs fetch with `answer` and returns the recorded calls. */
function stubFetch(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  });
  return calls;
}
const json = (status: number, data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe("sendMessage", () => {
  it("posts to the url with wait=true and returns the message id", async () => {
    const calls = stubFetch(() => json(200, { id: "999" }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "ok", id: "999" });
    expect(calls[0].url).toBe(`${hook.url}?wait=true`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual(body);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps 429 to a retry with retry_after plus 250 ms", async () => {
    stubFetch(() => json(429, { retry_after: 1.5 }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "retry", delayMs: 1750 });
  });

  it("falls back to the Retry-After header", async () => {
    stubFetch(() => new Response("", { status: 429, headers: { "retry-after": "2" } }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "retry", delayMs: 2250 });
  });

  it("maps 401 and 404 to gone", async () => {
    stubFetch(() => json(404, {}));
    expect(await sendMessage(hook, body)).toEqual({ kind: "gone", status: 404 });
    stubFetch(() => json(401, {}));
    expect(await sendMessage(hook, body)).toEqual({ kind: "gone", status: 401 });
  });

  it("carries Discord's error code of a 404", async () => {
    stubFetch(() => json(404, { code: 10008, message: "Unknown Message" }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "gone", status: 404, code: 10008 });
    stubFetch(() => json(404, { code: 10015, message: "Unknown Webhook" }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "gone", status: 404, code: 10015 });
  });

  it("maps another 4xx to rejected", async () => {
    stubFetch(() => json(400, { message: "bad" }));
    expect(await sendMessage(hook, body)).toEqual({ kind: "rejected", status: 400 });
  });

  it("maps 5xx and a thrown fetch error to failed, never naming the url", async () => {
    stubFetch(() => json(500, {}));
    const a = await sendMessage(hook, body);
    expect(a.kind).toBe("failed");
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    });
    const b = await sendMessage(hook, body);
    expect(b.kind).toBe("failed");
    for (const r of [a, b]) {
      if (r.kind !== "failed") throw new Error("unreachable");
      expect(r.error.message).not.toContain(MARKER);
      expect(r.error.message).not.toContain("discord.com");
      expect(r.error.message).toContain("team");
    }
  });

  it("sends multipart with payload_json and attachment references when there are files", async () => {
    const calls = stubFetch(() => json(200, { id: "5" }));
    const files = [{ name: "banner.png", bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }];
    const withImage: DiscordBody = { ...body, embeds: [{ title: "t", image: { url: "attachment://banner.png" } }] };
    expect(await sendMessage(hook, withImage, files)).toEqual({ kind: "ok", id: "5" });
    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const payload = JSON.parse(form.get("payload_json") as string);
    expect(payload.embeds[0].image.url).toBe("attachment://banner.png");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.attachments).toEqual([{ id: 0, filename: "banner.png" }]);
    expect((form.get("files[0]") as File).name).toBe("banner.png");
  });
});

describe("editMessage and deleteMessage", () => {
  it("PATCHes the stored message and returns its id", async () => {
    const calls = stubFetch(() => json(200, { id: "77" }));
    expect(await editMessage(hook, "77", body)).toEqual({ kind: "ok", id: "77" });
    expect(calls[0].url).toBe(`${hook.url}/messages/77`);
    expect(calls[0].init.method).toBe("PATCH");
  });

  it("DELETEs the stored message; a 204 is ok", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    expect(await deleteMessage(hook, "77")).toEqual({ kind: "ok", id: "77" });
    expect(calls[0].url).toBe(`${hook.url}/messages/77`);
    expect(calls[0].init.method).toBe("DELETE");
  });
});
