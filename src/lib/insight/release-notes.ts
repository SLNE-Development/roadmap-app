import { formatAdrNumber } from "@/lib/adr-number";

/** What {@link composeReleaseNotes} writes up. */
export interface ReleaseNotesInput {
  name: string;
  /** UTC day, `YYYY-MM-DD`. */
  shippedOn: string;
  shipped: { title: string; summary: string; lastUpdate: string | null }[];
  decisions: { number: number; title: string }[];
  notShipped: { title: string }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a `YYYY-MM-DD` day as `24 Oct 2026`, without any timezone conversion. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** The first line of the text, trimmed. */
function firstLine(text: string): string {
  return text.trim().split("\n")[0].trim();
}

/**
 * Composes the markdown of a release's first note. Empty sections are left out. A system's line
 * uses the first line of its summary, else the first line of its last update, else only the title. Titles are
 * not escaped: project members write them.
 */
export function composeReleaseNotes(input: ReleaseNotesInput): string {
  const sections = [`# ${input.name}`, `Shipped ${formatDay(input.shippedOn)}.`];
  if (input.shipped.length > 0) {
    const lines = input.shipped.map((s) => {
      const text = firstLine(s.summary) || (s.lastUpdate ? firstLine(s.lastUpdate) : "");
      return text ? `- **${s.title}**: ${text}` : `- **${s.title}**`;
    });
    sections.push(`## Shipped\n\n${lines.join("\n")}`);
  }
  if (input.decisions.length > 0) {
    sections.push(`## Decisions\n\n${input.decisions.map((d) => `- ADR-${formatAdrNumber(d.number)} ${d.title}`).join("\n")}`);
  }
  if (input.notShipped.length > 0) {
    sections.push(`## Not shipped\n\n${input.notShipped.map((s) => `- ${s.title}`).join("\n")}`);
  }
  return sections.join("\n\n");
}
