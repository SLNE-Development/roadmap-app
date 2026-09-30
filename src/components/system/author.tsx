import { AgentTag } from "@/components/chips";
import { PersonName } from "@/components/person-avatar";
import { cn } from "@/lib/utils";
import { parseAuthor } from "./text";

/** "Aiko Tanaka via claude-code" as inline text, the agent in mono. */
export function AuthorText({ label, className }: { label: string; className?: string }) {
  const { name, agent } = parseAuthor(label);
  return (
    <span className={className}>
      {name}
      {agent && (
        <>
          {" via "}
          <span className="font-mono">{agent}</span>
        </>
      )}
    </span>
  );
}

/** A person with avatar and, when an agent acted for them, the agent's tag. */
export function AuthorBadge({ label, className }: { label: string; className?: string }) {
  const { name, agent } = parseAuthor(label);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <PersonName name={name} className="font-medium" />
      {agent && <AgentTag agent={agent} />}
    </span>
  );
}
