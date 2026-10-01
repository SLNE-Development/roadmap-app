"use client";

import { Bot } from "lucide-react";
import { useNow } from "@/components/clock";
import { PersonAvatar } from "@/components/person-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PresentAgent, PresentPerson } from "@/lib/ops/presence";
import { relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";

const AGENT_SIZE = { xs: "size-5", sm: "size-[22px]" };
const ICON_SIZE = { xs: "size-3", sm: "size-3.5" };

/** `Claude Code (for Ammo)`: an agent and the person it works for. */
const agentLabel = (a: PresentAgent) => `${a.agent} (for ${a.name})`;

/**
 * Overlapping avatars of the people viewing a system and the agents working on it: people round, agents square with a
 * bot icon. Renders nothing when nobody is here. Beyond `max` avatars the rest is a "+N" chip; the tooltip and the
 * screen-reader text list everyone.
 */
export function PresenceStack({
  people,
  agents,
  max = 3,
  size = "sm",
}: {
  people: PresentPerson[];
  agents: PresentAgent[];
  max?: number;
  size?: "xs" | "sm";
}) {
  const now = useNow();
  const total = people.length + agents.length;
  if (total === 0) return null;
  const shownPeople = people.slice(0, max);
  const shownAgents = agents.slice(0, Math.max(0, max - shownPeople.length));
  const rest = total - shownPeople.length - shownAgents.length;
  const names = [...people.map((p) => p.name), ...agents.map(agentLabel)];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center">
          <span className="sr-only">Also here: {names.join(", ")}</span>
          <span aria-hidden className="flex items-center -space-x-1.5">
            {shownPeople.map((p) => (
              <span key={p.userId} data-presence-avatar className="flex">
                <PersonAvatar name={p.name} size={size} className="ring-2 ring-background" />
              </span>
            ))}
            {shownAgents.map((a) => (
              <span
                key={`${a.userId}-${a.agent}`}
                data-presence-avatar
                data-presence-agent
                className={cn("inline-flex shrink-0 items-center justify-center bg-fg-2 text-background ring-2 ring-background", AGENT_SIZE[size])}
              >
                <Bot className={ICON_SIZE[size]} />
              </span>
            ))}
            {rest > 0 && (
              <span className="z-10 pl-2.5 text-[11px] font-semibold text-muted-foreground">+{rest}</span>
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="flex flex-col gap-0.5">
          {people.map((p) => (
            <li key={p.userId}>{p.name}</li>
          ))}
          {agents.map((a) => (
            <li key={`${a.userId}-${a.agent}`}>
              {agentLabel(a)}, active {relativeAge(a.at, now)}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
