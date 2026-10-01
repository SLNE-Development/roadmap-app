import { describe, expect, it } from "vitest";
import { describeChange, type ChangeFacts } from "./change-sentence";

/** A change log entry with defaults for the fields a case does not care about. */
function entry(entity: string, field: string, oldValue: string | null = null, newValue: string | null = null, entityId = "11"): ChangeFacts {
  return { entity, entityId, field, oldValue, newValue };
}

/** The sentence flattened to text, the way the timeline reads it. */
function text(e: ChangeFacts, systemTitle: string | null = "Inventory", adrLabel: string | null = null): string {
  const s = describeChange(e, { systemTitle, adrLabel });
  return [s.verb, s.target, s.from !== undefined ? `${s.from} →` : null, s.to].filter(Boolean).join(" ");
}

describe("describeChange", () => {
  it("describes system moves within and across boards", () => {
    expect(text(entry("system", "column", "Development / In progress", "Development / Review"))).toBe("moved Inventory In progress → Review");
    expect(text(entry("system", "column", "Development / Done", "Launch / Todo"))).toBe("moved Inventory Development / Done → Launch / Todo");
    expect(describeChange(entry("system", "column", "A / B", "A / C"), { systemTitle: "Inventory" }).targetIsSystem).toBe(true);
  });

  it("describes system fields", () => {
    expect(text(entry("system", "created", null, "Inventory"))).toBe("created Inventory");
    expect(text(entry("system", "owner", null, "Tobias Keller"))).toBe("changed the owner of Inventory Unowned → Tobias Keller");
    expect(text(entry("system", "title", "Old", "New"))).toBe("renamed Inventory Old → New");
    expect(text(entry("system", "priority", "Later", "MVP"))).toBe("changed the priority of Inventory Later → MVP");
    expect(text(entry("system", "notes", "a", "b"))).toBe("edited the notes of Inventory");
  });

  it("describes task changes on a system", () => {
    expect(text(entry("task", "state", "doing", "done"))).toBe("completed task #11 on Inventory");
    expect(text(entry("task", "state", "todo", "doing"))).toBe("started task #11 on Inventory");
    expect(text(entry("task", "state", "doing", "blocked"))).toBe("set task #11 to blocked on Inventory");
    expect(text(entry("task", "state", "done", "todo"))).toBe("moved task #11 back to Todo on Inventory");
    expect(text(entry("task", "created", null, "Write tests"))).toBe("added task “Write tests” to Inventory");
    expect(text(entry("task", "owner", null, "Aiko"))).toBe("assigned task #11 to Aiko on Inventory");
  });

  it("drops the system when it is unknown", () => {
    expect(text(entry("task", "state", "doing", "done"), null)).toBe("completed task #11");
    expect(text(entry("system", "owner", "A", "B"), null)).toBe("changed the owner A → B");
    expect(describeChange(entry("task", "state", "doing", "done")).targetIsSystem).toBe(false);
  });

  it("describes documents, planning, questions and updates", () => {
    expect(text(entry("document", "spec", null, "v3"))).toBe("published v3 of the spec for Inventory");
    expect(text(entry("planning", "completed", null, "yes"))).toBe("completed planning of Inventory");
    expect(text(entry("planning", "area-reopened", "new partner API", "scope"))).toBe("reopened the scope area of Inventory");
    expect(text(entry("planning", "area-completed", "ok", "scope"))).toBe("completed the scope area of Inventory");
    expect(text(entry("planning", "area-reopened", "x", "scope"), null)).toBe("reopened a planning area");
    expect(text(entry("question", "created", null, "Who owns it?"))).toBe("asked “Who owns it?” on Inventory");
    expect(text(entry("question", "resolved", "false", "true"))).toBe("resolved a question on Inventory");
    expect(text(entry("update", "posted", null, "Done"))).toBe("posted an update on Inventory");
  });

  it("describes column rules and gate overrides", () => {
    const rules = entry("column", "rules", null, "all-tasks-done, update-within-days(3)", "col1");
    expect(describeChange(rules, { columnName: "Done" })).toMatchObject({ verb: "set entry rules of column Done:", to: "all-tasks-done, update-within-days(3)" });
    expect(text(rules, null)).toBe("set entry rules of a column: all-tasks-done, update-within-days(3)");
    expect(text(entry("column", "rules", "spec-exists", null), null)).toBe("removed the entry rules of a column");
    expect(text(entry("system", "gateOverride", "1 open task (#4)", "Done: shipping behind a flag"))).toBe(
      "moved Inventory past unmet rules: shipping behind a flag",
    );
    expect(text(entry("system", "gateOverride", "no spec", "Done: ok"), null)).toBe("moved a system past unmet rules: ok");
  });

  it("describes page changes", () => {
    expect(text(entry("page", "created", null, "Onboarding"), null)).toBe("created page “Onboarding”");
    expect(text(entry("page", "title", "Intro", "Onboarding"), null)).toBe("renamed a page Intro → Onboarding");
    expect(text(entry("page", "version", null, "v3"), null)).toBe("wrote a new version of a page v3");
    expect(text(entry("page", "deleted", "Onboarding", null), null)).toBe("deleted page “Onboarding”");
  });

  it("describes Discord webhook changes", () => {
    expect(text(entry("webhook", "created", null, "#roadmap"), null)).toBe("added Discord webhook “#roadmap”");
    expect(text(entry("webhook", "deleted", "#roadmap", null), null)).toBe("deleted Discord webhook “#roadmap”");
    expect(text(entry("webhook", "events", "system.done", "system.done, adr.accepted"), null)).toBe(
      "changed the events of a Discord webhook system.done → system.done, adr.accepted",
    );
    expect(text(entry("webhook", "boards", "All boards", "Launch"), null)).toBe("changed the boards of a Discord webhook All boards → Launch");
    expect(text(entry("webhook", "enabled", "true", "false"), null)).toBe("turned off a Discord webhook");
    expect(text(entry("webhook", "enabled", "false", "true"), null)).toBe("turned on a Discord webhook");
  });

  it("describes release changes", () => {
    expect(text(entry("release", "created", null, "1.0"), null)).toBe("created release 1.0");
    expect(text(entry("release", "name", "1.0", "One"), null)).toBe("renamed a release 1.0 → One");
    expect(text(entry("release", "slug", "1-0", "one"), null)).toBe("changed the slug of a release 1-0 → one");
    expect(text(entry("release", "targetDate", null, "2026-12-01"), null)).toBe("changed the target date of a release none → 2026-12-01");
    expect(text(entry("release", "status", "planned", "frozen"), null)).toBe("froze a release");
    expect(text(entry("release", "status", "frozen", "planned"), null)).toBe("unfroze a release");
    expect(text(entry("release", "status", "frozen", "shipped"), null)).toBe("shipped a release");
    expect(text(entry("release", "notes", null, "v2"), null)).toBe("wrote release notes v2");
    expect(text(entry("release", "deleted", "1.0", null), null)).toBe("deleted release 1.0");
  });

  it("names the release when it is known", () => {
    const named = (e: ChangeFacts) => {
      const s = describeChange(e, { releaseName: "One" });
      return [s.verb, s.target, s.from !== undefined ? `${s.from} →` : null, s.to].filter(Boolean).join(" ");
    };
    expect(named(entry("release", "slug", "1-0", "one"))).toBe("changed the slug of release One 1-0 → one");
    expect(named(entry("release", "targetDate", null, "2026-12-01"))).toBe("changed the target date of release One none → 2026-12-01");
    expect(named(entry("release", "status", "planned", "frozen"))).toBe("froze release One");
    expect(named(entry("release", "status", "frozen", "planned"))).toBe("unfroze release One");
    expect(named(entry("release", "status", "frozen", "shipped"))).toBe("shipped release One");
    expect(named(entry("release", "notes", null, "v2"))).toBe("wrote notes of release One v2");
  });

  it("describes a system joining or leaving a release", () => {
    expect(text(entry("system", "release", null, "1.0"))).toBe("changed the release of Inventory none → 1.0");
    expect(text(entry("system", "release", "1.0", null), null)).toBe("changed the release 1.0 → none");
  });

  it("describes repository changes", () => {
    expect(text(entry("repo", "created", null, "Org/roadmap"), null)).toBe("linked repository Org/roadmap");
    expect(text(entry("repo", "deleted", "Org/roadmap", null), null)).toBe("unlinked repository Org/roadmap");
    expect(text(entry("repo", "rules", "{}", "{}"), null)).toBe("changed the automation rules of a repository");
  });

  it("describes linked code", () => {
    expect(text(entry("code", "created", null, "PR #419"))).toBe("linked PR #419 to Inventory");
    expect(text(entry("code", "created", null, "Commit abc1234"))).toBe("linked Commit abc1234 to Inventory");
    expect(text(entry("code", "state", "open", "merged"))).toBe("changed the state of a linked pull request on Inventory open → merged");
    expect(text(entry("code", "checks", "pending", "failure"))).toBe("changed the checks of linked code on Inventory pending → failure");
    expect(text(entry("code", "created", null, "PR #419"), null)).toBe("linked code");
  });

  it("describes glossary changes", () => {
    expect(text(entry("glossary", "created", null, "Outbox"), null)).toBe("added glossary term “Outbox”");
    expect(text(entry("glossary", "definition", "Queue", "Pending events"), null)).toBe("changed a glossary definition");
    expect(text(entry("glossary", "deleted", "Outbox", null), null)).toBe("deleted glossary term “Outbox”");
  });

  it("describes decisions", () => {
    expect(text(entry("adr", "created", null, "ADR 0010: Use Redis"), null)).toBe("proposed ADR-0010 Use Redis");
    expect(text(entry("adr", "status", "proposed", "accepted"), null, "ADR-0010 Use Redis")).toBe("accepted ADR-0010 Use Redis");
    expect(text(entry("adr", "status", "proposed", "accepted"), null)).toBe("accepted a decision");
    expect(text(entry("adr", "status", "accepted", "superseded by 0012"), null, "ADR-0009 X")).toBe("superseded ADR-0009 X ADR-0012");
  });

  it("describes members and the project", () => {
    expect(text(entry("member", "role", null, "Aiko Tanaka: editor"), null)).toBe("added Aiko Tanaka as Editor");
    expect(text(entry("member", "role", "Aiko Tanaka: viewer", "Aiko Tanaka: editor"), null)).toBe("changed the role of Aiko Tanaka Viewer → Editor");
    expect(text(entry("member", "removed", "Aiko Tanaka: editor"), null)).toBe("removed Aiko Tanaka from the project");
    expect(text(entry("project", "created", null, "Surf"), null)).toBe("created the project Surf");
  });

  it("falls back to the field and entity", () => {
    expect(text(entry("widget", "colour", "red", "blue"), null)).toBe("changed colour of widget");
    expect(text(entry("board", "sortOrder"), null)).toBe("changed sortOrder of a board");
  });
});
