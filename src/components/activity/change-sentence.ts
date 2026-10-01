import { CATEGORY_LABEL, ROLE_LABEL, STATE_LABEL } from "@/components/chips";
import type { ColumnCategory, TaskState } from "@/db/schema";

/** The parts of a change log entry the sentence is built from. */
export interface ChangeFacts {
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** What the sentence may refer to besides the entry itself. */
export interface ChangeContext {
  /** Title of the system the change belongs to, when known. */
  systemTitle?: string | null;
  /** "ADR-0010 Title" of the ADR an `adr` entry refers to, when known. */
  adrLabel?: string | null;
  /** Name of the column a `column` entry refers to, when known. */
  columnName?: string | null;
}

/**
 * A readable sentence about one change, without its author: `verb`, then the
 * `target` (the system when `targetIsSystem`, else plain text), then an
 * optional `from → to`.
 */
export interface ChangeSentence {
  verb: string;
  target: string | null;
  targetIsSystem: boolean;
  from?: string;
  to?: string;
}

/** Field names shown in the fallback sentence. */
const FIELD_LABEL: Record<string, string> = {
  summary: "summary",
  notes: "notes",
  priority: "priority",
  domainId: "domain",
  phaseId: "phase",
  repoUrl: "repository URL",
  description: "description",
  name: "name",
  title: "title",
};

/** Human names of the entities in the fallback sentence. */
const ENTITY_LABEL: Record<string, string> = {
  system: "a system",
  task: "a task",
  adr: "a decision",
  question: "a question",
  board: "a board",
  column: "a column",
  project: "the project",
  member: "a member",
  domain: "a domain",
  phase: "a phase",
  planning: "planning",
  document: "a document",
  glossary: "a glossary term",
  page: "a page",
  update: "an update",
  webhook: "a Discord webhook",
  repo: "a repository",
};

/** Quotes a user-written value, shortened for one line. */
function quote(value: string | null): string {
  const text = (value ?? "").trim();
  return `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`;
}

/** The column name of a logged "Board / Column" value. */
function columnOf(value: string | null): string {
  if (!value) return "none";
  const i = value.lastIndexOf(" / ");
  return i === -1 ? value : value.slice(i + 3);
}

/** The board name of a logged "Board / Column" value. */
function boardOf(value: string | null): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(" / ");
  return i === -1 ? null : value.slice(0, i);
}

/** Splits a logged "Name: role" member value. */
function memberOf(value: string | null): { name: string; role: string } {
  const text = value ?? "";
  const i = text.lastIndexOf(": ");
  if (i === -1) return { name: text || "someone", role: "" };
  const role = text.slice(i + 2);
  return { name: text.slice(0, i), role: ROLE_LABEL[role] ?? role };
}

/** Sentence for an entry, with category names such as `Review` readable. */
function label(value: string | null): string {
  if (value === null || value === "") return "none";
  return CATEGORY_LABEL[value as ColumnCategory] ?? value;
}

/**
 * Builds a readable sentence for a change log entry, e.g. "moved Inventory
 * In progress → Review" or "completed task #11 on Inventory". Unknown
 * combinations read "changed <field> of <entity>".
 *
 * @param e the logged change
 * @param ctx titles the sentence can name
 */
export function describeChange(e: ChangeFacts, ctx: ChangeContext = {}): ChangeSentence {
  const system = ctx.systemTitle ?? null;
  /** A sentence ending in the system: "`base` `prep` System", or `alone` without one. */
  const onSystem = (base: string, prep: string, alone = base, extra: Partial<ChangeSentence> = {}): ChangeSentence =>
    system
      ? { verb: prep ? `${base} ${prep}` : base, target: system, targetIsSystem: true, ...extra }
      : { verb: alone, target: null, targetIsSystem: false, ...extra };
  const plain = (verb: string, target: string | null = null, extra: Partial<ChangeSentence> = {}): ChangeSentence => ({
    verb,
    target,
    targetIsSystem: false,
    ...extra,
  });
  const change = { from: label(e.oldValue), to: label(e.newValue) };

  switch (`${e.entity}:${e.field}`) {
    case "system:created":
      return onSystem("created", "", `created ${quote(e.newValue)}`);
    case "system:column": {
      const [fromBoard, toBoard] = [boardOf(e.oldValue), boardOf(e.newValue)];
      const sameBoard = fromBoard === toBoard;
      return onSystem("moved", "", "moved a system", {
        from: sameBoard ? columnOf(e.oldValue) : (e.oldValue ?? "none"),
        to: sameBoard ? columnOf(e.newValue) : (e.newValue ?? "none"),
      });
    }
    case "system:owner":
      return onSystem("changed the owner of", "", "changed the owner", { from: e.oldValue ?? "Unowned", to: e.newValue ?? "Unowned" });
    case "system:title":
      return onSystem("renamed", "", "renamed a system", { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "system:priority":
      return onSystem("changed the priority of", "", "changed the priority", change);
    case "system:summary":
      return onSystem("edited the summary of", "", "edited the summary");
    case "system:notes":
      return onSystem("edited the notes of", "", "edited the notes");
    case "system:domainId":
      return onSystem("changed the domain of", "", "changed the domain");
    case "system:phaseId":
      return onSystem("changed the phase of", "", "changed the phase");
    case "system:gateOverride": {
      // newValue is "<column>: <reason>".
      const text = e.newValue ?? "";
      const i = text.indexOf(": ");
      return onSystem("moved", "", "moved a system", { to: `past unmet rules: ${i === -1 ? text : text.slice(i + 2)}` });
    }

    case "task:created":
      return onSystem(`added task ${quote(e.newValue)}`, "to");
    case "task:deleted":
      return onSystem(`deleted task ${quote(e.oldValue)}`, "from");
    case "task:title":
      return onSystem(`renamed task #${e.entityId}`, "on", undefined, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "task:priority":
      return onSystem(`changed the priority of task #${e.entityId}`, "on", undefined, change);
    case "task:owner":
      return e.newValue
        ? onSystem(`assigned task #${e.entityId} to ${e.newValue}`, "on")
        : onSystem(`unassigned task #${e.entityId}`, "on");
    case "task:state": {
      const id = `task #${e.entityId}`;
      if (e.newValue === "done") return onSystem(`completed ${id}`, "on");
      if (e.newValue === "doing") return onSystem(`started ${id}`, "on");
      if (e.newValue === "blocked") return onSystem(`set ${id} to blocked`, "on");
      const state = STATE_LABEL[e.newValue as TaskState] ?? label(e.newValue);
      return onSystem(`moved ${id} back to ${state}`, "on");
    }

    case "document:spec":
    case "document:plan":
      return onSystem(`published ${e.newValue ?? "a new version"} of the ${e.field}`, "for");

    case "planning:round":
      return onSystem("opened a planning round", "on");
    case "planning:answers":
      return onSystem("answered planning questions", "on");
    case "planning:completed":
      return onSystem("completed planning of", "", "completed planning");
    case "planning:reopened":
      return onSystem("reopened planning of", "", "reopened planning");
    case "planning:area-reopened":
      return onSystem(`reopened the ${e.newValue ?? "planning"} area of`, "", "reopened a planning area");
    case "planning:area-completed":
      return onSystem(`completed the ${e.newValue ?? "planning"} area of`, "", "completed a planning area");

    case "question:created":
      return onSystem(`asked ${quote(e.newValue)}`, "on");
    case "question:answer":
      return onSystem("answered a question", "on");
    case "question:resolved":
      return onSystem(e.newValue === "true" ? "resolved a question" : "reopened a question", "on");

    case "glossary:created":
      return plain("added glossary term", quote(e.newValue));
    case "glossary:definition":
      return plain("changed a glossary definition");
    case "glossary:deleted":
      return plain("deleted glossary term", quote(e.oldValue));

    case "page:created":
      return plain("created page", quote(e.newValue));
    case "page:title":
      return plain("renamed a page", null, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "page:version":
      return plain("wrote a new version of a page", null, { to: e.newValue ?? "" });
    case "page:deleted":
      return plain("deleted page", quote(e.oldValue));

    case "webhook:created":
      return plain("added Discord webhook", quote(e.newValue));
    case "webhook:deleted":
      return plain("deleted Discord webhook", quote(e.oldValue));
    case "webhook:events":
      return plain("changed the events of a Discord webhook", null, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "webhook:boards":
      return plain("changed the boards of a Discord webhook", null, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "webhook:enabled":
      return plain(e.newValue === "true" ? "turned on a Discord webhook" : "turned off a Discord webhook");

    case "repo:created":
      return plain("linked repository", e.newValue);
    case "repo:deleted":
      return plain("unlinked repository", e.oldValue);
    case "repo:rules":
      return plain("changed the automation rules of a repository");

    case "update:posted":
      return onSystem("posted an update on", "", "posted an update");

    case "adr:created": {
      const match = /^ADR (\d+): (.*)$/.exec(e.newValue ?? "");
      return plain("proposed", match ? `ADR-${match[1]} ${match[2]}` : (ctx.adrLabel ?? "a decision"));
    }
    case "adr:edited":
      return plain("edited", ctx.adrLabel ?? "a proposed decision");
    case "adr:status": {
      const target = ctx.adrLabel ?? "a decision";
      if (e.newValue === "accepted") return plain("accepted", target);
      const by = /^superseded by (\d+)$/.exec(e.newValue ?? "");
      if (by) return plain("superseded", target, { to: `ADR-${by[1]}`, from: undefined });
      return plain("changed the status of", target, change);
    }

    case "board:created":
      return plain("created the board", e.newValue);
    case "board:name":
      return plain("renamed a board", null, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "board:columns":
      return plain("changed the columns of a board");
    case "column:rules": {
      const column = ctx.columnName ? `column ${ctx.columnName}` : "a column";
      return e.newValue ? plain(`set entry rules of ${column}:`, null, { to: e.newValue }) : plain(`removed the entry rules of ${column}`);
    }

    case "member:role": {
      const next = memberOf(e.newValue);
      if (!e.oldValue) return plain(`added ${next.name} as ${next.role}`);
      return plain("changed the role of", next.name, { from: memberOf(e.oldValue).role, to: next.role });
    }
    case "member:removed":
      return plain(`removed ${memberOf(e.oldValue).name} from the project`);

    case "project:created":
      return plain("created the project", e.newValue);
    case "project:name":
      return plain("renamed the project", null, { from: e.oldValue ?? "", to: e.newValue ?? "" });
    case "project:description":
      return plain("edited the project description");
    case "project:repoUrl":
      return plain("changed the repository URL", null, { to: e.newValue ?? "none" });

    case "domain:created":
    case "phase:created":
      return plain(`added the ${e.entity}`, e.newValue);
    case "domain:deleted":
    case "phase:deleted":
      return plain(`deleted the ${e.entity}`, e.oldValue);
  }

  const field = FIELD_LABEL[e.field] ?? e.field;
  if (e.entity === "system" && system) return { verb: `changed ${field} of`, target: system, targetIsSystem: true };
  return plain(`changed ${field} of ${ENTITY_LABEL[e.entity] ?? e.entity}`);
}

/**
 * The versions to compare for a "wrote spec/plan v<N>" entry, or `null` for any
 * other entry and for a first version.
 */
export function documentCompare(e: Pick<ChangeFacts, "entity" | "field" | "newValue">): { tab: "spec" | "plan"; from: number; to: number } | null {
  if (e.entity !== "document" || (e.field !== "spec" && e.field !== "plan")) return null;
  const m = /^v(\d+)$/.exec(e.newValue ?? "");
  const to = m ? Number(m[1]) : 0;
  return to > 1 ? { tab: e.field, from: to - 1, to } : null;
}
