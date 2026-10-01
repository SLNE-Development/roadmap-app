import { useTranslations } from "next-intl";
import { AgentTag } from "@/components/chips";
import { PersonName } from "@/components/person-avatar";
import { cn } from "@/lib/utils";

/** "Aiko Tanaka via claude-code" as inline text, the agent in mono. */
export function AuthorText({ name, agent, className }: { name: string; agent: string | null; className?: string }) {
  const t = useTranslations("system.author");
  return (
    <span className={className}>
      {name}
      {agent && (
        <>
          {` ${t("via")} `}
          <span className="font-mono">{agent}</span>
        </>
      )}
    </span>
  );
}

/** A person with avatar and, when an agent acted for them, the agent's tag. */
export function AuthorBadge({ name, agent, className }: { name: string; agent: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <PersonName name={name} className="font-medium" />
      {agent && <AgentTag agent={agent} />}
    </span>
  );
}
