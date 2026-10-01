import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduledEvent, deleteScheduledEvent, scheduledEventUrl, updateScheduledEvent } from "./discord-bot";

const TOKEN = "BOTTOKENSECRET.abc.def-0123456789";
const body = { name: "Piratenfest", description: "Beschreibung", startsAt: new Date("2026-10-17T18:00:00Z"), endsAt: new Date("2026-10-17T20:00:00Z"), location: "Hafenwelt" };

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

describe("createScheduledEvent", () => {
  it("posts an external guild-only event with an end time and the bot header", async () => {
    const calls = stubFetch(() => json(200, { id: "555" }));
    const result = await createScheduledEvent(TOKEN, "42", { ...body, imageDataUri: "data:image/png;base64,AAAA" });
    expect(result).toEqual({ kind: "ok", value: { id: "555" } });
    expect(calls[0].url).toBe("https://discord.com/api/v10/guilds/42/scheduled-events");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bot ${TOKEN}`);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "Piratenfest",
      description: "Beschreibung",
      scheduled_start_time: "2026-10-17T18:00:00.000Z",
      scheduled_end_time: "2026-10-17T20:00:00.000Z",
      entity_type: 3,
      privacy_level: 2,
      entity_metadata: { location: "Hafenwelt" },
      image: "data:image/png;base64,AAAA",
    });
  });

  it("cuts the name to 100 and the description to 1000 characters", async () => {
    const calls = stubFetch(() => json(200, { id: "1" }));
    await createScheduledEvent(TOKEN, "42", { ...body, name: "n".repeat(150), description: "d".repeat(1500) });
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.name).toHaveLength(100);
    expect(sent.description).toHaveLength(1000);
  });

  it("maps 401 and 403 to denied, keeping Discord's code", async () => {
    stubFetch(() => json(401, {}));
    expect(await createScheduledEvent(TOKEN, "42", body)).toEqual({ kind: "denied", status: 401 });
    stubFetch(() => json(403, { code: 50013, message: "Missing Permissions" }));
    expect(await createScheduledEvent(TOKEN, "42", body)).toEqual({ kind: "denied", status: 403, code: 50013 });
  });

  it("maps 404 to gone, 429 to retry and another 4xx to rejected", async () => {
    stubFetch(() => json(404, {}));
    expect(await createScheduledEvent(TOKEN, "42", body)).toEqual({ kind: "gone" });
    stubFetch(() => json(429, { retry_after: 2 }));
    expect(await createScheduledEvent(TOKEN, "42", body)).toEqual({ kind: "retry", delayMs: 2250 });
    stubFetch(() => json(400, { message: "Invalid Form Body" }));
    expect(await createScheduledEvent(TOKEN, "42", body)).toEqual({ kind: "rejected", status: 400, message: "Invalid Form Body" });
  });

  it("never lets the token into an error or a result", async () => {
    stubFetch(() => json(400, { message: `bad ${TOKEN} here` }));
    expect(JSON.stringify(await createScheduledEvent(TOKEN, "42", body))).not.toContain(TOKEN);
    stubFetch(() => json(500, {}));
    expect(JSON.stringify(await createScheduledEvent(TOKEN, "42", body))).not.toContain(TOKEN);
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error(`connect to Bot ${TOKEN} failed`), { cause: { code: "ECONNRESET" } });
    });
    const result = await createScheduledEvent(TOKEN, "42", body);
    expect(result.kind).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    if (result.kind === "failed") expect(result.error.message).not.toContain(TOKEN);
  });
});

describe("updateScheduledEvent and deleteScheduledEvent", () => {
  it("patches only the given fields", async () => {
    const calls = stubFetch(() => json(200, { id: "555" }));
    expect(await updateScheduledEvent(TOKEN, "42", "555", { name: "Neu" })).toEqual({ kind: "ok", value: { id: "555" } });
    expect(calls[0].url).toBe("https://discord.com/api/v10/guilds/42/scheduled-events/555");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: "Neu" });
  });

  it("answers gone for an event that no longer exists", async () => {
    stubFetch(() => json(404, { code: 10070 }));
    expect(await updateScheduledEvent(TOKEN, "42", "555", { name: "x" })).toEqual({ kind: "gone" });
    expect(await deleteScheduledEvent(TOKEN, "42", "555")).toEqual({ kind: "gone" });
  });

  it("deletes with a 204", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    expect(await deleteScheduledEvent(TOKEN, "42", "555")).toEqual({ kind: "ok", value: true });
    expect(calls[0].init.method).toBe("DELETE");
  });
});

describe("scheduledEventUrl", () => {
  it("links the event in its guild", () => {
    expect(scheduledEventUrl("42", "555")).toBe("https://discord.com/events/42/555");
  });
});
