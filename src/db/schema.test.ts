import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { board, project } from "@/db/schema";
import { isUniqueViolation } from "@/lib/ops/errors";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";

describe("schema", () => {
  it("applies the migrations to an empty database", async () => {
    const db = await createTestDb();
    const rows = await db.select().from(project);
    expect(rows).toEqual([]);
  });

  it("rejects two boards with the same slug in one project", async () => {
    const db = await createTestDb();
    await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "p", name: "P" });
    await db.insert(board).values({ id: "b1", projectId: "p1", slug: "dev", name: "Dev", sortOrder: 0 });
    const error = await db
      .insert(board)
      .values({ id: "b2", projectId: "p1", slug: "dev", name: "Dev 2", sortOrder: 1 })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("creates the lookup indexes", async () => {
    const db = await createTestDb();
    const result = (await db.execute(sql`select indexname from pg_indexes where schemaname = 'public'`)) as { rows: { indexname: string }[] };
    expect(result.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "change_log_project_id_idx",
        "change_log_system_id_idx",
        "question_project_id_idx",
        "question_system_id_idx",
        "progress_update_system_id_idx",
        "board_column_board_id_idx",
        "system_board_id_idx",
        "system_column_id_idx",
        "system_owner_user_id_idx",
        "task_system_id_idx",
        "task_owner_user_id_idx",
        "adr_system_system_id_idx",
        "planning_item_round_id_idx",
        "project_member_user_id_idx",
        "domain_project_id_idx",
        "phase_project_id_idx",
        "phase_dependency_depends_on_id_idx",
        "session_user_id_idx",
        "account_user_id_idx",
        "apikey_reference_id_idx",
        "apikey_key_idx",
      ]),
    );
  });

  it("gives every test its own database", async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.insert(project).values({ id: "p1", slug: "p", name: "P" });
    expect(await b.select().from(project)).toEqual([]);
  });

  it("backfills answerers and member join dates when migrating existing data", async () => {
    const client = new PGlite();
    const apply = async (file: string) => {
      for (const statement of readFileSync(`./drizzle/${file}`, "utf8").split("--> statement-breakpoint")) await client.exec(statement);
    };
    await apply("0000_init.sql");
    await client.exec(`
      INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES ('u1', 'Ann', 'a@x.test', now(), now()), ('u2', 'Ben', 'b@x.test', now(), now());
      INSERT INTO project (id, slug, name, created_at) VALUES ('p1', 'p', 'P', '2026-01-01T00:00:00Z');
      INSERT INTO project_member (project_id, user_id, role) VALUES ('p1', 'u1', 'owner'), ('p1', 'u2', 'editor');
      INSERT INTO question (id, project_id, title, answer) VALUES ('q1', 'p1', 'A?', 'Yes'), ('q2', 'p1', 'B?', NULL);
      INSERT INTO change_log (project_id, entity, entity_id, field, old_value, new_value, author_user_id, agent, created_at) VALUES
        ('p1', 'member', 'u2', 'role', NULL, 'Ben: viewer', 'u1', NULL, '2026-02-01T00:00:00Z'),
        ('p1', 'member', 'u2', 'role', 'Ben: viewer', 'Ben: editor', 'u1', NULL, '2026-03-01T00:00:00Z'),
        ('p1', 'question', 'q1', 'answer', NULL, 'No', 'u1', NULL, '2026-04-01T00:00:00Z'),
        ('p1', 'question', 'q1', 'answer', 'No', 'Yes', 'u2', 'Claude Code', '2026-05-01T00:00:00Z');
    `);
    await apply("0001_answerer_member_since.sql");
    const questions = await client.query("SELECT id, answered_by_user_id, answered_agent, answered_at FROM question ORDER BY id");
    expect(questions.rows).toEqual([
      { id: "q1", answered_by_user_id: "u2", answered_agent: "Claude Code", answered_at: new Date("2026-05-01T00:00:00Z") },
      { id: "q2", answered_by_user_id: null, answered_agent: null, answered_at: null },
    ]);
    const members = await client.query("SELECT user_id, created_at FROM project_member ORDER BY user_id");
    expect(members.rows).toEqual([
      { user_id: "u1", created_at: new Date("2026-01-01T00:00:00Z") },
      { user_id: "u2", created_at: new Date("2026-02-01T00:00:00Z") },
    ]);
  });
});
