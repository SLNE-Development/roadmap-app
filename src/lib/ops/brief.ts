import type { Db } from "@/db/types";
import { formatAdrNumber } from "@/lib/adr-number";
import type { Actor } from "./actor";
import { listAdrs } from "./adrs";
import { glossaryBrief } from "./glossary";
import { getProject } from "./projects";
import { listQuestions } from "./questions";
import { listPhases } from "./structure";
import { listSystems, type SystemListItem } from "./systems";

/** Longest brief in characters. */
const BRIEF_LIMIT = 4000;
/** Most systems listed under Active and Blocked. */
const MAX_SYSTEMS = 15;
/** Most glossary terms listed. */
const MAX_TERMS = 10;
/** Open questions listed, oldest first. */
const MAX_QUESTIONS = 5;

/** A markdown list that can be cut to its first `shown` items. */
interface Section {
  heading: string;
  /** Lines before the list, such as a count. */
  lead?: string;
  items: string[];
  shown: number;
}

/** Cuts a text to one line of at most `max` characters. */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `- <title> (<slug>) · <column> · <owner or unowned> · <open tasks> open`. */
function systemLine(s: SystemListItem): string {
  return `- ${s.title} (${s.slug}) · ${s.columnName} · ${s.ownerName ?? "unowned"} · ${s.tasksTotal - s.tasksDone} open`;
}

/** Renders a section, ending a cut list with `- …and N more`. */
function renderSection(s: Section): string {
  const lines = [`## ${s.heading}`];
  if (s.lead) lines.push(s.lead);
  lines.push(...s.items.slice(0, s.shown));
  if (s.shown < s.items.length) lines.push(`- …and ${s.items.length - s.shown} more`);
  return lines.join("\n");
}

/** Renders the head and the sections as one markdown text. */
function render(head: string, sections: Section[]): string {
  return [head, ...sections.filter((s) => s.items.length > 0 || s.lead).map(renderSection)].join("\n\n");
}

/**
 * A markdown brief of a project for an agent's first look: phases, active and blocked
 * systems, open questions and proposed decisions, at most 4 000 characters. When it is
 * longer, the glossary goes first, then the longest lists are cut with `- …and N more`.
 *
 * @throws NotFoundError if the project does not exist or the actor cannot see it
 */
export async function projectBrief(db: Db, actor: Actor, slug: string): Promise<string> {
  const { project } = await getProject(db, actor, slug);
  const [phases, systems, questions, adrs, terms] = await Promise.all([
    listPhases(db, actor, slug),
    listSystems(db, actor, slug),
    listQuestions(db, actor, slug, { resolved: false }),
    listAdrs(db, actor, slug, { status: "proposed" }),
    glossaryBrief(db, project.id),
  ]);

  const firstLine = project.description.split("\n").find((l) => l.trim() !== "")?.trim();
  const head = [`# ${project.name} (${project.slug})`, firstLine].filter(Boolean).join("\n\n");

  const active = systems.filter((s) => s.columnCategory === "active" || s.columnCategory === "review");
  const blocked = systems.filter((s) => s.columnCategory === "blocked");
  const oldest = [...questions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  const list = (heading: string, items: string[], max: number, lead?: string): Section => ({ heading, lead, items, shown: Math.min(items.length, max) });
  const sections: Section[] = [
    list(
      "Phases",
      phases.map((p) => {
        const inPhase = systems.filter((s) => s.phaseId === p.id);
        return `- ${p.name}: ${inPhase.filter((s) => s.columnCategory === "done").length}/${inPhase.length} done`;
      }),
      Infinity,
    ),
    list("Active", active.map(systemLine), MAX_SYSTEMS),
    list("Blocked", blocked.map(systemLine), MAX_SYSTEMS),
    list("Open questions", oldest.map((q) => `- Q${q.id}: ${oneLine(q.text, 100)}`), MAX_QUESTIONS, questions.length > 0 ? `${questions.length} open, oldest first:` : undefined),
    list("Proposed decisions", adrs.map((a) => `- ADR-${formatAdrNumber(a.number)} ${a.title}`), Infinity),
  ];
  const glossary = list("Glossary", terms.map((t) => `- ${t.term}: ${oneLine(t.definition, 100)}`), MAX_TERMS);

  let text = render(head, [...sections, glossary]);
  if (text.length <= BRIEF_LIMIT) return text;
  text = render(head, sections);
  while (text.length > BRIEF_LIMIT) {
    const longest = sections.filter((s) => s.shown > 0).sort((a, b) => renderSection(b).length - renderSection(a).length)[0];
    if (!longest) return text.slice(0, BRIEF_LIMIT);
    longest.shown -= 1;
    text = render(head, sections);
  }
  return text;
}
