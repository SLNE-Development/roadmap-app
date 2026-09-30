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
    expect(text(entry("question", "created", null, "Who owns it?"))).toBe("asked “Who owns it?” on Inventory");
    expect(text(entry("question", "resolved", "false", "true"))).toBe("resolved a question on Inventory");
    expect(text(entry("update", "posted", null, "Done"))).toBe("posted an update on Inventory");
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
