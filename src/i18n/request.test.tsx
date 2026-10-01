import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";
import { setPref } from "@/lib/ops/prefs";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import de from "../../messages/de.json";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/actor", () => ({ sessionActor: async () => null }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));

const { loadRequestConfig } = await import("./request");

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

describe("loadRequestConfig", () => {
  it("uses the locale preference and its messages", async () => {
    const actor = await insertUser(db);
    await setPref(db, actor, "locale", "de");
    const config = await loadRequestConfig({ db, userId: actor.userId, acceptLanguage: "en" });
    expect(config.locale).toBe("de");
    expect(config.messages.common).toEqual(de.common);
  });

  it("falls back to Accept-Language without a user", async () => {
    const config = await loadRequestConfig({ db, userId: null, acceptLanguage: "de" });
    expect(config.locale).toBe("de");
    expect(config.timeZone).toBe("UTC");
  });

  it("uses the time zone preference", async () => {
    const actor = await insertUser(db);
    await setPref(db, actor, "timeZone", "Europe/Berlin");
    expect((await loadRequestConfig({ db, userId: actor.userId, acceptLanguage: null })).timeZone).toBe("Europe/Berlin");
  });

  it("defaults the time zone to UTC and the locale to English", async () => {
    const actor = await insertUser(db);
    const config = await loadRequestConfig({ db, userId: actor.userId, acceptLanguage: null });
    expect(config.timeZone).toBe("UTC");
    expect(config.locale).toBe("en");
  });
});

/** Renders a translated word. */
function Probe() {
  return <span>{useTranslations("common")("save")}</span>;
}

describe("NextIntlClientProvider", () => {
  it("renders translated messages for the locale", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Speichern");
  });

  it("renders the same markup twice with a fixed now", () => {
    const render = () =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin" now={new Date(0)}>
          <Probe />
        </NextIntlClientProvider>,
      );
    expect(render()).toBe(render());
  });
});
