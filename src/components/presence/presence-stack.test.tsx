import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PresentAgent, PresentPerson } from "@/lib/ops/presence";
import de from "../../../messages/de";
import en from "../../../messages/en";
import { TooltipProvider } from "../ui/tooltip";
import { PresenceStack } from "./presence-stack";

const at = "2026-10-01T10:00:00.000Z";
const person = (name: string): PresentPerson => ({ userId: `u-${name}`, name, at });
const agent: PresentAgent = { userId: "u-Ammo", name: "Ammo", agent: "Claude Code", at };

const render = (props: Parameters<typeof PresenceStack>[0], locale: "en" | "de" = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      <TooltipProvider>
        <PresenceStack {...props} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );

describe("PresenceStack", () => {
  it("renders nothing when nobody is here", () => {
    expect(render({ people: [], agents: [] })).toBe("");
  });

  it("shows two people and an agent with an accessible list", () => {
    const html = render({ people: [person("Jules"), person("Rik")], agents: [agent] });
    expect(html).toContain("Also here: Jules, Rik, Claude Code (for Ammo)");
    expect(html.match(/data-presence-avatar/g)).toHaveLength(3);
    expect(html).not.toContain("+");
  });

  it("caps the avatars at max and counts the rest", () => {
    const people = ["A", "B", "C", "D", "E"].map(person);
    const html = render({ people, agents: [], max: 3 });
    expect(html.match(/data-presence-avatar/g)).toHaveLength(3);
    expect(html).toContain("+2");
    expect(html).toContain("Also here: A, B, C, D, E");
  });

  it("reads in German", () => {
    const html = render({ people: [person("Jules")], agents: [agent] }, "de");
    expect(html).toContain("Auch hier: Jules, Claude Code (für Ammo)");
  });

  it("draws agents as squares with a bot icon and people as circles", () => {
    const html = render({ people: [person("Jules")], agents: [agent] });
    expect(html.match(/rounded-full/g)).toHaveLength(1);
    expect(html).toContain("lucide-bot");
    const agentAvatar = html.match(/<span[^>]*data-presence-agent[^>]*>/)?.[0] ?? "";
    expect(agentAvatar).not.toContain("rounded-full");
  });
});
