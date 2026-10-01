import { z } from "zod";

/** A prompt the MCP server offers: its arguments and the text it expands to. */
export interface McpPrompt {
  name: "next" | "status" | "plan";
  description: string;
  args: z.ZodRawShape;
  text(args: { project?: string; system?: string }): string;
}

const project = z.string().describe("Project slug");

/** The prompts every MCP client can invoke; they only name registered tools. */
export const MCP_PROMPTS: McpPrompt[] = [
  {
    name: "next",
    description: "Propose the next task to work on, then ask before starting it.",
    args: { project },
    text: ({ project }) =>
      [
        `Find the next task to work on in roadmap project ${project}.`,
        "1. Call list_phases, then list_systems with startable true (systems with blockedBy are skipped), then get_system for the candidates.",
        "2. A candidate task is in state todo, in a system whose planning is complete and whose phase dependencies are done. It is unowned or owned by the current user (whoami).",
        "3. Rank by priority: MVP, then Later, then Nice to have.",
        "4. Propose the top three with one line of reasoning each and ask which one to start. Do not start anything before the user chooses.",
        "5. After they choose, update_task with state doing.",
      ].join("\n"),
  },
  {
    name: "status",
    description: "Show a project's active, blocked and planning systems without changing anything.",
    args: { project },
    text: ({ project }) =>
      [
        `Show the status of roadmap project ${project}. Change nothing.`,
        "1. Call list_systems for the project.",
        "2. Group the systems by column category in this order: active, blocked, review, planning, then only a count of todo and done.",
        "3. For planning systems, call get_system on at most five of them and say how many planning items are still open.",
        "4. For each system show title, board, column, owner and tasks done/total.",
        "5. End with the three newest entries of list_updates.",
      ].join("\n"),
  },
  {
    name: "plan",
    description: "Run the planning interview for a new or existing system.",
    args: { project, system: z.string().optional().describe("System slug to resume; omit for a new one") },
    text: ({ project, system }) =>
      [
        `Run the planning interview for ${system ? `system ${system} of` : "a new system in"} roadmap project ${project}. No spec, plan or code before it passes.`,
        system ? "1. get_system and get_planning, then resume from the gaps." : "1. Ask for title and slug, then create_system.",
        "2. Rounds of at most four hard questions on failure modes, dependencies, scope and ops-testing. Call add_planning_round BEFORE asking each round.",
        "3. Right after the user answers, call answer_planning_items with their words. Never answer for them; a dodge stays open.",
        "4. Repeat until get_planning lists only the missing spec as a gap.",
        "5. write_spec, show it, and ask the user to confirm it in their own words.",
        "6. complete_planning with that confirmation verbatim.",
      ].join("\n"),
  },
];
