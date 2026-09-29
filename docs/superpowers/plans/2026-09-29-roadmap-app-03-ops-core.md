# Part 3: Core ops layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** Every project-scoped read and write except documents, planning and ADRs: access checks, projects, members, boards and columns, domains and phases, systems, tasks, progress updates, questions and activity.

**Spec:** sections 5.2, 5.3, 6.

**Consumes from Parts 1–2:** `Db`, `Executor`, schema tables and enum tuples, `newId`, `Actor`, `authorLabel`, `logChange`, `OpError` subclasses, `isUniqueViolation`, `loadActor`, `createTestDb`, `insertUser`.

Conventions for every op in this part:
- Signature `op(db, actor, projectSlug, …, raw)`; `raw` is `z.input<typeof xInput>` and is parsed first.
- Writes run in `db.transaction` and call `logChange` with `systemId` set whenever the change concerns a system or its tasks.
- Invisible projects and entities throw `NotFoundError`; too low a role throws `ForbiddenError` (from `projectAccess`).

---

### Task 3.1: Access checks, lookups and project fixtures

**Files:**
- Create: `src/lib/ops/access.ts`, `src/lib/ops/lookup.ts`
- Modify: `src/test/fixtures.ts` (append helpers)
- Test: `src/lib/ops/access.test.ts`

**Interfaces:**
- Produces:
  - `slugSchema` (zod), `type ProjectRow`, `type AccessRole = ProjectRole | "admin"`, `interface ProjectAccess { project: ProjectRow; role: AccessRole }`
  - `projectAccess(db: Executor, actor: Actor, slug: string, need: ProjectRole): Promise<ProjectAccess>`
  - `projectAccessById(db: Executor, actor: Actor, projectId: string, need: ProjectRole): Promise<ProjectAccess>`
  - `type SystemRow`, `type BoardRow`, `type BoardColumnRow`, `interface BoardWithColumns extends BoardRow { columns: BoardColumnRow[] }`
  - `findSystem(db: Executor, projectId: string, slug: string, lock?: boolean): Promise<SystemRow>`
  - `findBoard(db: Executor, projectId: string, slug: string): Promise<BoardWithColumns>`
  - `loadBoards(db: Executor, projectId: string): Promise<BoardWithColumns[]>`
  - `systemAccess(db: Executor, actor: Actor, projectSlug: string, systemSlug: string, need: ProjectRole): Promise<ProjectAccess & { system: SystemRow }>`
  - `userName(db: Executor, userId: string | null): Promise<string | null>`
  - Fixtures: `createProjectFixture(db: Db, slug?: string): Promise<{ owner: Actor; slug: string; projectId: string }>`, `addMemberFixture(db: Db, owner: Actor, slug: string, role: ProjectRole): Promise<Actor>`, `completePlanningFixture(db: Db, systemId: string): Promise<void>` (sets `planningCompletedAt` directly; used until Part 4's real gate exists)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { project, projectMember } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { projectAccess } from "./access";

describe("projectAccess", () => {
  it("reports projects the actor is not a member of as not found", async () => {
    const db = await createTestDb();
    const outsider = await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    await expect(projectAccess(db, outsider, "demo", "viewer")).rejects.toMatchObject({ status: 404, message: "Unknown project demo." });
    await expect(projectAccess(db, outsider, "nope", "viewer")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a role that is too low with 403", async () => {
    const db = await createTestDb();
    const viewer = await insertUser(db);
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    await db.insert(projectMember).values({ projectId: "p1", userId: viewer.userId, role: "viewer" });
    expect((await projectAccess(db, viewer, "demo", "viewer")).role).toBe("viewer");
    await expect(projectAccess(db, viewer, "demo", "editor")).rejects.toMatchObject({
      status: 403,
      message: "This needs the editor role in project demo; you are viewer.",
    });
  });

  it("gives admins owner rights in every project", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await db.insert(project).values({ id: "p1", slug: "demo", name: "Demo" });
    expect((await projectAccess(db, admin, "demo", "owner")).role).toBe("admin");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/access.test.ts`
Expected: FAIL, `./access` not found.

- [ ] **Step 3: Implement access and lookups**

`src/lib/ops/access.ts`:

```ts
import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { project, projectMember, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { ForbiddenError, NotFoundError } from "./errors";

/** A URL-safe identifier: lowercase letters and digits separated by single dashes, at most 64 characters. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase letters, digits and single dashes");

/** A project row. */
export type ProjectRow = typeof project.$inferSelect;

/** The effective role of an actor in a project; admins rank above owners. */
export type AccessRole = ProjectRole | "admin";

/** A project the actor may access, with their effective role. */
export interface ProjectAccess {
  project: ProjectRow;
  role: AccessRole;
}

/** Rank of each role; a higher rank includes every right of a lower one. */
const RANK: Record<AccessRole, number> = { viewer: 1, editor: 2, owner: 3, admin: 4 };

/** Loads the project matching `where` with the actor's membership role and checks `need`. */
async function access(db: Executor, actor: Actor, where: SQL, label: string, need: ProjectRole): Promise<ProjectAccess> {
  const [row] = await db
    .select({ project, role: projectMember.role })
    .from(project)
    .leftJoin(projectMember, and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId)))
    .where(where)
    .limit(1);
  if (!row || (!row.role && !actor.isAdmin)) throw new NotFoundError(`Unknown project ${label}.`);
  const role: AccessRole = actor.isAdmin ? "admin" : (row.role as ProjectRole);
  if (RANK[role] < RANK[need]) {
    throw new ForbiddenError(`This needs the ${need} role in project ${row.project.slug}; you are ${role}.`);
  }
  return { project: row.project, role };
}

/**
 * Returns the project with `slug` if the actor may act in it with at least `need`.
 *
 * @throws NotFoundError if it does not exist or the actor is not a member (and not an admin)
 * @throws ForbiddenError if the actor's role is below `need`
 */
export function projectAccess(db: Executor, actor: Actor, slug: string, need: ProjectRole): Promise<ProjectAccess> {
  return access(db, actor, eq(project.slug, slug), slug, need);
}

/** Same as {@link projectAccess}, looking the project up by id. */
export function projectAccessById(db: Executor, actor: Actor, projectId: string, need: ProjectRole): Promise<ProjectAccess> {
  return access(db, actor, eq(project.id, projectId), projectId, need);
}
```

`src/lib/ops/lookup.ts`:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import { board, boardColumn, system, user, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess, type ProjectAccess } from "./access";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** A system row. */
export type SystemRow = typeof system.$inferSelect;

/** A board row. */
export type BoardRow = typeof board.$inferSelect;

/** A board column row. */
export type BoardColumnRow = typeof boardColumn.$inferSelect;

/** A board with its columns in order. */
export interface BoardWithColumns extends BoardRow {
  columns: BoardColumnRow[];
}

/**
 * Returns the system with `slug` in the project, optionally locking its row
 * until the surrounding transaction ends.
 *
 * @throws NotFoundError if there is none
 */
export async function findSystem(db: Executor, projectId: string, slug: string, lock = false): Promise<SystemRow> {
  const query = db
    .select()
    .from(system)
    .where(and(eq(system.projectId, projectId), eq(system.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new NotFoundError(`Unknown system ${slug}.`);
  return row;
}

/** Returns every board of a project in order, each with its columns in order. */
export async function loadBoards(db: Executor, projectId: string): Promise<BoardWithColumns[]> {
  const boards = await db.select().from(board).where(eq(board.projectId, projectId)).orderBy(asc(board.sortOrder), asc(board.name));
  if (boards.length === 0) return [];
  const columns = await db
    .select()
    .from(boardColumn)
    .where(
      inArray(
        boardColumn.boardId,
        boards.map((b) => b.id),
      ),
    )
    .orderBy(asc(boardColumn.sortOrder));
  return boards.map((b) => ({ ...b, columns: columns.filter((c) => c.boardId === b.id) }));
}

/**
 * Returns the board with `slug` in the project, with its columns.
 *
 * @throws NotFoundError if there is none
 */
export async function findBoard(db: Executor, projectId: string, slug: string): Promise<BoardWithColumns> {
  const [row] = await db
    .select()
    .from(board)
    .where(and(eq(board.projectId, projectId), eq(board.slug, slug)))
    .limit(1);
  if (!row) throw new NotFoundError(`Unknown board ${slug}.`);
  const columns = await db.select().from(boardColumn).where(eq(boardColumn.boardId, row.id)).orderBy(asc(boardColumn.sortOrder));
  return { ...row, columns };
}

/** Checks project access with `need` and returns the access together with the system. */
export async function systemAccess(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  need: ProjectRole,
): Promise<ProjectAccess & { system: SystemRow }> {
  const found = await projectAccess(db, actor, projectSlug, need);
  return { ...found, system: await findSystem(db, found.project.id, systemSlug) };
}

/** Returns a user's name, or `null` for no user or an unknown id. */
export async function userName(db: Executor, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/ops/access.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ops/access.ts src/lib/ops/lookup.ts src/lib/ops/access.test.ts
git commit -m "feat: Add project access checks and entity lookups"
```

---

### Task 3.2: Projects and members

**Files:**
- Create: `src/lib/ops/boards.ts` (only `DEFAULT_COLUMNS`, `columnRuleViolation` and `insertBoard` in this task; Task 3.3 adds the rest), `src/lib/ops/projects.ts`, `src/lib/ops/members.ts`
- Modify: `src/test/fixtures.ts`
- Test: `src/lib/ops/projects.test.ts`, `src/lib/ops/members.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_COLUMNS: readonly { name: string; category: ColumnCategory }[]`
  - `columnRuleViolation(columns: { category: ColumnCategory }[]): string | null`
  - `insertBoard(tx: Executor, projectId: string, input: { slug: string; name: string }, sortOrder: number): Promise<BoardWithColumns>`
  - `createProjectInput`, `updateProjectInput` (zod)
  - `createProject(db: Db, actor: Actor, raw): Promise<ProjectRow>` — creator becomes owner, board `development` created
  - `interface ProjectListItem extends ProjectRow { role: AccessRole }`; `listProjects(db: Executor, actor: Actor): Promise<ProjectListItem[]>` (by name)
  - `interface ProjectDetail { project: ProjectRow; role: AccessRole; boards: BoardWithColumns[] }`; `getProject(db: Executor, actor: Actor, slug: string): Promise<ProjectDetail>`
  - `updateProject(db: Db, actor: Actor, slug: string, raw): Promise<ProjectRow>` (owner)
  - `deleteProject(db: Db, actor: Actor, slug: string): Promise<void>` (owner)
  - `interface MemberItem { userId: string; name: string; image: string | null; role: ProjectRole }`
  - `listMembers(db: Executor, actor: Actor, slug: string): Promise<MemberItem[]>` (viewer, by name)
  - `setMemberInput` (zod `{ userId, role }`); `setMember(db: Db, actor: Actor, slug: string, raw): Promise<void>` (owner)
  - `removeMember(db: Db, actor: Actor, slug: string, userId: string): Promise<void>` (owner)
  - `isMember(db: Executor, projectId: string, userId: string): Promise<boolean>`

- [ ] **Step 1: Append the project fixtures**

Append to `src/test/fixtures.ts`:

```ts
import { eq } from "drizzle-orm";
import { system as systemTable, type ProjectRole } from "@/db/schema";
import { createProject } from "@/lib/ops/projects";
import { setMember } from "@/lib/ops/members";

/**
 * Creates an owner and a project owned by them (with its default board).
 *
 * @param db the test database
 * @param slug the project slug, `demo` by default
 */
export async function createProjectFixture(db: Db, slug = "demo"): Promise<{ owner: Actor; slug: string; projectId: string }> {
  const owner = await insertUser(db, { name: "Owner" });
  const row = await createProject(db, owner, { slug, name: slug.toUpperCase() });
  return { owner, slug, projectId: row.id };
}

/** Creates a provisioned user and adds them to the project with `role`. */
export async function addMemberFixture(db: Db, owner: Actor, slug: string, role: ProjectRole): Promise<Actor> {
  const member = await insertUser(db, { name: `${role} member` });
  await setMember(db, owner, slug, { userId: member.userId, role });
  return member;
}

/** Marks a system's planning as complete directly in the database. */
export async function completePlanningFixture(db: Db, systemId: string): Promise<void> {
  await db
    .update(systemTable)
    .set({ planningCompletedAt: new Date(), planningConfirmation: "fixture" })
    .where(eq(systemTable.id, systemId));
}
```

Move the new `import` lines to the top of the file next to the existing imports.

- [ ] **Step 2: Write the failing tests**

`src/lib/ops/projects.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { columnRuleViolation, DEFAULT_COLUMNS } from "./boards";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./projects";

describe("createProject", () => {
  it("makes the creator owner and adds a Development board with the default columns", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const detail = await getProject(db, owner, slug);
    expect(detail.role).toBe("owner");
    expect(detail.boards.map((b) => b.slug)).toEqual(["development"]);
    expect(detail.boards[0].columns.map((c) => [c.name, c.category])).toEqual(DEFAULT_COLUMNS.map((c) => [c.name, c.category]));
    expect(columnRuleViolation(detail.boards[0].columns)).toBeNull();
  });

  it("rejects a taken slug and non-http repository URLs", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db, "demo");
    await expect(createProject(db, owner, { slug: "demo", name: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "Project slug demo is taken.",
    });
    await expect(createProject(db, owner, { slug: "x", name: "X", repoUrl: "javascript:alert(1)" })).rejects.toThrow(/repoUrl/);
    await expect(createProject(db, owner, { slug: "Bad Slug", name: "X" })).rejects.toThrow(/slug/);
  });
});

describe("listProjects", () => {
  it("shows members their projects and admins every project", async () => {
    const db = await createTestDb();
    await createProjectFixture(db, "alpha");
    const { owner } = await createProjectFixture(db, "beta");
    const admin = await insertUser(db, { isAdmin: true });
    expect((await listProjects(db, owner)).map((p) => [p.slug, p.role])).toEqual([["beta", "owner"]]);
    expect((await listProjects(db, admin)).map((p) => [p.slug, p.role])).toEqual([
      ["alpha", "admin"],
      ["beta", "admin"],
    ]);
  });
});

describe("updateProject and deleteProject", () => {
  it("logs each changed field and deletes everything with the project", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await updateProject(db, owner, slug, { name: "Renamed", repoUrl: "https://github.com/x/y" });
    const fields = (await db.select().from(changeLog)).map((c) => c.field);
    expect(fields).toEqual(["created", "name", "repoUrl"]);
    await deleteProject(db, owner, slug);
    expect(await listProjects(db, owner)).toEqual([]);
    expect(await db.select().from(changeLog)).toEqual([]);
  });
});
```

`src/lib/ops/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listMembers, removeMember, setMember } from "./members";
import { removeAllowedAccount } from "./users";

describe("members", () => {
  it("adds, re-roles and lists members by name", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await setMember(db, owner, slug, { userId: editor.userId, role: "viewer" });
    expect((await listMembers(db, owner, slug)).map((m) => [m.name, m.role])).toEqual([
      ["Owner", "owner"],
      ["editor member", "viewer"],
    ]);
  });

  it("only lets owners manage members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const other = await insertUser(db);
    await expect(setMember(db, editor, slug, { userId: other.userId, role: "viewer" })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses users that are not provisioned", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const gone = await insertUser(db, { discordId: "323456789012345678" });
    await removeAllowedAccount(db, admin, "323456789012345678");
    await expect(setMember(db, owner, slug, { userId: gone.userId, role: "viewer" })).rejects.toMatchObject({ status: 404 });
  });

  it("always keeps one owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(setMember(db, owner, slug, { userId: owner.userId, role: "editor" })).rejects.toMatchObject({
      status: 409,
      message: "A project needs at least one owner.",
    });
    await expect(removeMember(db, owner, slug, owner.userId)).rejects.toMatchObject({ status: 409 });
    const second = await addMemberFixture(db, owner, slug, "owner");
    await removeMember(db, second, slug, owner.userId);
    expect((await listMembers(db, second, slug)).map((m) => m.role)).toEqual(["owner"]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/lib/ops/projects.test.ts src/lib/ops/members.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the board basics**

`src/lib/ops/boards.ts` (first half; Task 3.3 appends):

```ts
import { and, asc, eq, inArray, isNull, max, count } from "drizzle-orm";
import { z } from "zod";
import { board, boardColumn, COLUMN_CATEGORIES, system, type ColumnCategory } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, isUniqueViolation } from "./errors";
import { logChange } from "./log";
import { findBoard, loadBoards, type BoardWithColumns } from "./lookup";

/** Columns every new board starts with. */
export const DEFAULT_COLUMNS: readonly { name: string; category: ColumnCategory }[] = [
  { name: "Planning", category: "planning" },
  { name: "Todo", category: "todo" },
  { name: "In progress", category: "active" },
  { name: "Review", category: "review" },
  { name: "Blocked", category: "blocked" },
  { name: "Done", category: "done" },
];

/**
 * Returns why a column set is not a valid board, or `null` when it is: a board
 * has exactly one planning column and at least one done column.
 */
export function columnRuleViolation(columns: { category: ColumnCategory }[]): string | null {
  const planning = columns.filter((c) => c.category === "planning").length;
  if (planning !== 1) return `A board needs exactly one planning column; this has ${planning}.`;
  if (!columns.some((c) => c.category === "done")) return "A board needs at least one done column.";
  return null;
}

/** Inserts a board with the default columns and returns it. */
export async function insertBoard(
  tx: Executor,
  projectId: string,
  input: { slug: string; name: string },
  sortOrder: number,
): Promise<BoardWithColumns> {
  const [row] = await tx.insert(board).values({ id: newId(), projectId, slug: input.slug, name: input.name, sortOrder }).returning();
  const columns = await tx
    .insert(boardColumn)
    .values(DEFAULT_COLUMNS.map((c, i) => ({ id: newId(), boardId: row.id, name: c.name, category: c.category, sortOrder: i })))
    .returning();
  return { ...row, columns };
}
```

(The unused imports are used by Task 3.3; if lint fails on them now, add them in Task 3.3 instead.)

- [ ] **Step 5: Implement projects and members**

`src/lib/ops/projects.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { project, projectMember } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { insertBoard } from "./boards";
import { ConflictError, isUniqueViolation } from "./errors";
import { logChange } from "./log";
import { loadBoards, type BoardWithColumns } from "./lookup";

/** An http(s) URL, or null. */
const repoUrlSchema = z.url({ protocol: /^https?$/ }).nullable();

/** Input of {@link createProject}. */
export const createProjectInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  repoUrl: repoUrlSchema.default(null),
});

/** Input of {@link updateProject}; omitted fields stay unchanged. */
export const updateProjectInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  repoUrl: repoUrlSchema.optional(),
});

/** A project in the actor's list, with their effective role. */
export interface ProjectListItem extends ProjectRow {
  role: AccessRole;
}

/** A project with the actor's role and its boards. */
export interface ProjectDetail {
  project: ProjectRow;
  role: AccessRole;
  boards: BoardWithColumns[];
}

/**
 * Creates a project owned by the actor, with a Development board.
 *
 * @throws ConflictError if the slug is taken
 */
export async function createProject(db: Db, actor: Actor, raw: z.input<typeof createProjectInput>): Promise<ProjectRow> {
  const input = createProjectInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(project).values({ id: newId(), ...input }).returning();
      await tx.insert(projectMember).values({ projectId: row.id, userId: actor.userId, role: "owner" });
      await insertBoard(tx, row.id, { slug: "development", name: "Development" }, 0);
      await logChange(tx, actor, { projectId: row.id, entity: "project", entityId: row.id, field: "created", newValue: row.name });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Project slug ${input.slug} is taken.`);
    throw error;
  }
}

/** Lists the projects the actor belongs to (every project for admins), by name. */
export async function listProjects(db: Executor, actor: Actor): Promise<ProjectListItem[]> {
  const membership = and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId));
  const base = db.select({ project, role: projectMember.role }).from(project);
  const rows = actor.isAdmin
    ? await base.leftJoin(projectMember, membership).orderBy(asc(project.name))
    : await base.innerJoin(projectMember, membership).orderBy(asc(project.name));
  return rows.map((r) => ({ ...r.project, role: actor.isAdmin ? "admin" : (r.role as AccessRole) }));
}

/** Returns a project the actor can see, with their role and its boards. */
export async function getProject(db: Executor, actor: Actor, slug: string): Promise<ProjectDetail> {
  const found = await projectAccess(db, actor, slug, "viewer");
  return { ...found, boards: await loadBoards(db, found.project.id) };
}

/** Changes name, description or repository URL, logging each changed field. Owner only. */
export async function updateProject(db: Db, actor: Actor, slug: string, raw: z.input<typeof updateProjectInput>): Promise<ProjectRow> {
  const patch = updateProjectInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project: current } = await projectAccess(tx, actor, slug, "owner");
    const changes: Partial<ProjectRow> = {};
    for (const field of ["name", "description", "repoUrl"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      await logChange(tx, actor, {
        projectId: current.id,
        entity: "project",
        entityId: current.id,
        field,
        oldValue: current[field],
        newValue: next,
      });
    }
    if (Object.keys(changes).length === 0) return current;
    const [row] = await tx.update(project).set(changes).where(eq(project.id, current.id)).returning();
    return row;
  });
}

/** Deletes a project and everything in it. Owner only. */
export async function deleteProject(db: Db, actor: Actor, slug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project: current } = await projectAccess(tx, actor, slug, "owner");
    await tx.delete(project).where(eq(project.id, current.id));
  });
}
```

`src/lib/ops/members.ts`:

```ts
import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { PROJECT_ROLES, projectMember, user, type ProjectRole } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { loadActor } from "./users";

/** A project member as listed. */
export interface MemberItem {
  userId: string;
  name: string;
  image: string | null;
  role: ProjectRole;
}

/** Input of {@link setMember}. */
export const setMemberInput = z.object({ userId: z.string().min(1), role: z.enum(PROJECT_ROLES) });

/** Returns whether the user is a member of the project, in any role. */
export async function isMember(db: Executor, projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Throws if removing or demoting `userId` would leave the project without an owner. */
async function keepAnOwner(tx: Executor, projectId: string, userId: string): Promise<void> {
  const [row] = await tx
    .select({ n: count() })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, "owner"), ne(projectMember.userId, userId)));
  if (row.n === 0) throw new ConflictError("A project needs at least one owner.");
}

/** Lists the members of a project, by name. */
export async function listMembers(db: Executor, actor: Actor, slug: string): Promise<MemberItem[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  return db
    .select({ userId: user.id, name: user.name, image: user.image, role: projectMember.role })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, project.id))
    .orderBy(asc(user.name));
}

/**
 * Adds a provisioned user to the project or changes their role. Owner only.
 *
 * @throws NotFoundError if the user is unknown or no longer provisioned
 * @throws ConflictError if it would demote the last owner
 */
export async function setMember(db: Db, actor: Actor, slug: string, raw: z.input<typeof setMemberInput>): Promise<void> {
  const input = setMemberInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "owner");
    const target = await loadActor(tx, input.userId);
    if (!target) throw new NotFoundError(`Unknown user ${input.userId}.`);
    const [current] = await tx
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, input.userId)));
    if (current?.role === input.role) return;
    if (current?.role === "owner") await keepAnOwner(tx, project.id, input.userId);
    await tx
      .insert(projectMember)
      .values({ projectId: project.id, userId: input.userId, role: input.role })
      .onConflictDoUpdate({ target: [projectMember.projectId, projectMember.userId], set: { role: input.role } });
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "member",
      entityId: input.userId,
      field: "role",
      oldValue: current ? `${target.name}: ${current.role}` : null,
      newValue: `${target.name}: ${input.role}`,
    });
  });
}

/**
 * Removes a member from the project. Owner only.
 *
 * @throws NotFoundError if the user is not a member
 * @throws ConflictError if they are the last owner
 */
export async function removeMember(db: Db, actor: Actor, slug: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "owner");
    const [current] = await tx
      .select({ role: projectMember.role, name: user.name })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)));
    if (!current) throw new NotFoundError(`User ${userId} is not a member of ${slug}.`);
    if (current.role === "owner") await keepAnOwner(tx, project.id, userId);
    await tx.delete(projectMember).where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)));
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "member",
      entityId: userId,
      field: "removed",
      oldValue: `${current.name}: ${current.role}`,
    });
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/ops/projects.test.ts src/lib/ops/members.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Add projects and project membership ops"
```

---

### Task 3.3: Boards and columns

**Files:**
- Modify: `src/lib/ops/boards.ts` (append)
- Test: `src/lib/ops/boards.test.ts`

**Interfaces:**
- Produces:
  - `createBoardInput` (zod `{ slug, name }`), `updateBoardInput` (zod `{ name?, sortOrder? }`), `columnInput` (zod `{ id?, name, category }`), `setColumnsInput` (zod `{ columns: columnInput[2..20] }`)
  - `listBoards(db: Executor, actor: Actor, projectSlug: string): Promise<BoardWithColumns[]>` (viewer)
  - `createBoard(db: Db, actor: Actor, projectSlug: string, raw): Promise<BoardWithColumns>` (owner)
  - `updateBoard(db: Db, actor: Actor, projectSlug: string, boardSlug: string, raw): Promise<void>` (owner)
  - `setBoardColumns(db: Db, actor: Actor, projectSlug: string, boardSlug: string, raw): Promise<BoardWithColumns>` (owner)

- [ ] **Step 1: Write the failing tests**

`src/lib/ops/boards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { system } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { columnRuleViolation, createBoard, listBoards, setBoardColumns, updateBoard } from "./boards";
import { findBoard } from "./lookup";

describe("columnRuleViolation", () => {
  it("demands exactly one planning column and at least one done column", () => {
    expect(columnRuleViolation([{ category: "planning" }, { category: "done" }])).toBeNull();
    expect(columnRuleViolation([{ category: "todo" }, { category: "done" }])).toBe(
      "A board needs exactly one planning column; this has 0.",
    );
    expect(columnRuleViolation([{ category: "planning" }, { category: "planning" }, { category: "done" }])).toMatch(/has 2/);
    expect(columnRuleViolation([{ category: "planning" }, { category: "todo" }])).toBe("A board needs at least one done column.");
  });
});

describe("boards", () => {
  it("creates boards with default columns, in order, owner only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await expect(createBoard(db, editor, slug, { slug: "art", name: "Art" })).rejects.toMatchObject({ status: 403 });
    await expect(createBoard(db, owner, slug, { slug: "building", name: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "Board slug building is taken in this project.",
    });
    const boards = await listBoards(db, editor, slug);
    expect(boards.map((b) => b.slug)).toEqual(["development", "building"]);
    expect(boards[1].columns).toHaveLength(6);
    await updateBoard(db, owner, slug, "building", { name: "Map building" });
    expect((await listBoards(db, owner, slug))[1].name).toBe("Map building");
  });
});

describe("setBoardColumns", () => {
  it("renames, reorders, adds and removes columns", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const before = await findBoard(db, projectId, "development");
    const [planning, , , , , done] = before.columns;
    const result = await setBoardColumns(db, owner, slug, "development", {
      columns: [
        { id: planning.id, name: "Idea", category: "planning" },
        { name: "Sketch", category: "active" },
        { id: done.id, name: "Shipped", category: "done" },
      ],
    });
    expect(result.columns.map((c) => [c.name, c.category, c.sortOrder])).toEqual([
      ["Idea", "planning", 0],
      ["Sketch", "active", 1],
      ["Shipped", "done", 2],
    ]);
    expect(result.columns[0].id).toBe(planning.id);
  });

  it("enforces the board rules", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { name: "A", category: "todo" },
          { name: "B", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: "A board needs exactly one planning column; this has 0." });
  });

  it("refuses to drop a column that still holds systems", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const b = await findBoard(db, projectId, "development");
    await db.insert(system).values({ id: "s1", projectId, boardId: b.id, columnId: b.columns[1].id, slug: "s", title: "S", sortOrder: 0 });
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: b.columns[0].id, name: "Planning", category: "planning" },
          { id: b.columns[5].id, name: "Done", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Column "Todo" still holds 1 system; move it first.' });
  });

  it("refuses to turn the planning column into another category while it holds unplanned systems", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const b = await findBoard(db, projectId, "development");
    await db.insert(system).values({ id: "s1", projectId, boardId: b.id, columnId: b.columns[0].id, slug: "s", title: "S", sortOrder: 0 });
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: b.columns[0].id, name: "Planning", category: "todo" },
          { name: "New planning", category: "planning" },
          { id: b.columns[5].id, name: "Done", category: "done" },
          ...b.columns.slice(1, 5).map((c) => ({ id: c.id, name: c.name, category: c.category })),
        ],
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Column "Planning" holds systems that are still in planning; it must stay the planning column.' });
  });

  it("rejects column ids from another board", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const other = await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    const dev = await findBoard(db, projectId, "development");
    await expect(
      setBoardColumns(db, owner, slug, "development", {
        columns: [
          { id: other.columns[0].id, name: "Planning", category: "planning" },
          { id: dev.columns[5].id, name: "Done", category: "done" },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, message: `Column ${other.columns[0].id} is not on board development.` });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/boards.test.ts`
Expected: FAIL, `createBoard` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/ops/boards.ts`:

```ts
/** Input of {@link createBoard}. */
export const createBoardInput = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(60) });

/** Input of {@link updateBoard}; omitted fields stay unchanged. */
export const updateBoardInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** One column in {@link setColumnsInput}: an existing column (with `id`) or a new one. */
export const columnInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  category: z.enum(COLUMN_CATEGORIES),
});

/** Input of {@link setBoardColumns}: the complete new column list, in order. */
export const setColumnsInput = z.object({ columns: z.array(columnInput).min(2).max(20) });

/** Lists the project's boards with their columns. */
export async function listBoards(db: Executor, actor: Actor, projectSlug: string): Promise<BoardWithColumns[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  return loadBoards(db, project.id);
}

/**
 * Adds a board with the default columns after the existing boards. Owner only.
 *
 * @throws ConflictError if the slug is taken in this project
 */
export async function createBoard(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createBoardInput>): Promise<BoardWithColumns> {
  const input = createBoardInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "owner");
      const [{ last }] = await tx.select({ last: max(board.sortOrder) }).from(board).where(eq(board.projectId, project.id));
      const created = await insertBoard(tx, project.id, input, (last ?? -1) + 1);
      await logChange(tx, actor, { projectId: project.id, entity: "board", entityId: created.id, field: "created", newValue: created.name });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Board slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/** Renames a board or changes its position. Owner only. */
export async function updateBoard(
  db: Db,
  actor: Actor,
  projectSlug: string,
  boardSlug: string,
  raw: z.input<typeof updateBoardInput>,
): Promise<void> {
  const patch = updateBoardInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findBoard(tx, project.id, boardSlug);
    if (patch.name !== undefined && patch.name !== current.name) {
      await logChange(tx, actor, { projectId: project.id, entity: "board", entityId: current.id, field: "name", oldValue: current.name, newValue: patch.name });
    }
    if (patch.name !== undefined || patch.sortOrder !== undefined) {
      await tx.update(board).set(patch).where(eq(board.id, current.id));
    }
  });
}

/**
 * Replaces a board's columns with `columns`, in that order: listed ids are kept
 * (renamed, recategorised, reordered), entries without id are created, and
 * existing columns missing from the list are deleted. Owner only.
 *
 * @throws ConflictError if the result breaks {@link columnRuleViolation}, a deleted
 *         column still holds systems, or a planning column holding unplanned systems changes category
 * @throws InvalidError if an id belongs to another board
 */
export async function setBoardColumns(
  db: Db,
  actor: Actor,
  projectSlug: string,
  boardSlug: string,
  raw: z.input<typeof setColumnsInput>,
): Promise<BoardWithColumns> {
  const { columns } = setColumnsInput.parse(raw);
  const violation = columnRuleViolation(columns);
  if (violation) throw new ConflictError(violation);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findBoard(tx, project.id, boardSlug);
    const byId = new Map(current.columns.map((c) => [c.id, c]));
    for (const c of columns) {
      if (c.id && !byId.has(c.id)) throw new InvalidError(`Column ${c.id} is not on board ${boardSlug}.`);
    }
    const keptIds = new Set(columns.flatMap((c) => (c.id ? [c.id] : [])));
    const removed = current.columns.filter((c) => !keptIds.has(c.id));
    if (removed.length > 0) {
      const counts = await tx
        .select({ columnId: system.columnId, n: count() })
        .from(system)
        .where(inArray(system.columnId, removed.map((c) => c.id)))
        .groupBy(system.columnId);
      const busy = counts.find((c) => c.n > 0);
      if (busy) {
        const name = byId.get(busy.columnId)?.name;
        throw new ConflictError(`Column "${name}" still holds ${busy.n} system${busy.n === 1 ? "" : "s"}; move ${busy.n === 1 ? "it" : "them"} first.`);
      }
    }
    for (const c of columns) {
      const old = c.id ? byId.get(c.id) : undefined;
      if (old?.category === "planning" && c.category !== "planning") {
        const unplanned = await tx
          .select({ id: system.id })
          .from(system)
          .where(and(eq(system.columnId, old.id), isNull(system.planningCompletedAt)))
          .limit(1);
        if (unplanned.length > 0) {
          throw new ConflictError(`Column "${old.name}" holds systems that are still in planning; it must stay the planning column.`);
        }
      }
    }
    if (removed.length > 0) await tx.delete(boardColumn).where(inArray(boardColumn.id, removed.map((c) => c.id)));
    for (const [i, c] of columns.entries()) {
      if (c.id) await tx.update(boardColumn).set({ name: c.name, category: c.category, sortOrder: i }).where(eq(boardColumn.id, c.id));
      else await tx.insert(boardColumn).values({ id: newId(), boardId: current.id, name: c.name, category: c.category, sortOrder: i });
    }
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "board",
      entityId: current.id,
      field: "columns",
      oldValue: current.columns.map((c) => c.name).join(" → "),
      newValue: columns.map((c) => c.name).join(" → "),
    });
    return findBoard(tx, project.id, boardSlug);
  });
}
```

Remove imports the file does not use (for example `asc`) so lint passes.

- [ ] **Step 4: Run the tests and commit**

```bash
npx vitest run src/lib/ops/boards.test.ts
git add -A
git commit -m "feat: Add boards with custom, category-tagged columns"
```

Expected: all board tests pass.

---

### Task 3.4: Domains and phases

**Files:**
- Create: `src/lib/ops/structure.ts`
- Test: `src/lib/ops/structure.test.ts`

**Interfaces:**
- Produces:
  - `domainInput` (zod `{ name, description }`), `phaseInput` (zod `{ name, goal, dependsOn: string[] }`)
  - `type DomainRow`; `listDomains(db: Executor, actor: Actor, slug: string): Promise<DomainRow[]>`; `createDomain(db: Db, actor, slug, raw): Promise<DomainRow>` (editor); `deleteDomain(db: Db, actor, slug, id: string): Promise<void>` (editor)
  - `interface PhaseItem extends PhaseRow { dependsOn: string[] }`; `listPhases(db, actor, slug): Promise<PhaseItem[]>`; `createPhase(db, actor, slug, raw): Promise<PhaseItem>` (editor); `deletePhase(db, actor, slug, id): Promise<void>` (editor)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/structure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { createDomain, createPhase, deleteDomain, deletePhase, listDomains, listPhases } from "./structure";

describe("domains and phases", () => {
  it("creates, lists in order and deletes domains", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const police = await createDomain(db, editor, slug, { name: "Police" });
    await createDomain(db, editor, slug, { name: "Vehicles", description: "Cars" });
    expect((await listDomains(db, editor, slug)).map((d) => d.name)).toEqual(["Police", "Vehicles"]);
    await deleteDomain(db, editor, slug, police.id);
    expect((await listDomains(db, editor, slug)).map((d) => d.name)).toEqual(["Vehicles"]);
  });

  it("stores phase dependencies within the project only", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreign = await createPhase(db, other.owner, "other", { name: "Foreign" });
    const p0 = await createPhase(db, owner, slug, { name: "P0", goal: "Boot" });
    const p1 = await createPhase(db, owner, slug, { name: "P1", dependsOn: [p0.id] });
    expect(p1.dependsOn).toEqual([p0.id]);
    await expect(createPhase(db, owner, slug, { name: "P2", dependsOn: [foreign.id] })).rejects.toMatchObject({
      status: 400,
      message: `Unknown phase ${foreign.id}.`,
    });
    await deletePhase(db, owner, slug, p0.id);
    expect((await listPhases(db, owner, slug)).map((p) => [p.name, p.dependsOn])).toEqual([["P1", []]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/structure.test.ts`
Expected: FAIL, `./structure` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/structure.ts`:

```ts
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { domain, phase, phaseDependency } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";

/** A domain row. */
export type DomainRow = typeof domain.$inferSelect;

/** A phase row. */
export type PhaseRow = typeof phase.$inferSelect;

/** A phase with the ids of the phases it builds on. */
export interface PhaseItem extends PhaseRow {
  dependsOn: string[];
}

/** Input of {@link createDomain}. */
export const domainInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).default(""),
});

/** Input of {@link createPhase}. */
export const phaseInput = z.object({
  name: z.string().trim().min(1).max(60),
  goal: z.string().trim().max(2000).default(""),
  dependsOn: z.array(z.string()).max(20).default([]),
});

/** Lists the project's domains in order. */
export async function listDomains(db: Executor, actor: Actor, slug: string): Promise<DomainRow[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  return db.select().from(domain).where(eq(domain.projectId, project.id)).orderBy(asc(domain.sortOrder));
}

/** Adds a domain after the existing ones. Editor or higher. */
export async function createDomain(db: Db, actor: Actor, slug: string, raw: z.input<typeof domainInput>): Promise<DomainRow> {
  const input = domainInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const [{ last }] = await tx.select({ last: max(domain.sortOrder) }).from(domain).where(eq(domain.projectId, project.id));
    const [row] = await tx
      .insert(domain)
      .values({ id: newId(), projectId: project.id, ...input, sortOrder: (last ?? -1) + 1 })
      .returning();
    await logChange(tx, actor, { projectId: project.id, entity: "domain", entityId: row.id, field: "created", newValue: row.name });
    return row;
  });
}

/** Deletes a domain; its systems keep existing without a domain. Editor or higher. */
export async function deleteDomain(db: Db, actor: Actor, slug: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const deleted = await tx
      .delete(domain)
      .where(and(eq(domain.id, id), eq(domain.projectId, project.id)))
      .returning({ name: domain.name });
    if (deleted.length === 0) throw new NotFoundError(`Unknown domain ${id}.`);
    await logChange(tx, actor, { projectId: project.id, entity: "domain", entityId: id, field: "deleted", oldValue: deleted[0].name });
  });
}

/** Lists the project's phases in order with their dependencies. */
export async function listPhases(db: Executor, actor: Actor, slug: string): Promise<PhaseItem[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const phases = await db.select().from(phase).where(eq(phase.projectId, project.id)).orderBy(asc(phase.sortOrder));
  if (phases.length === 0) return [];
  const deps = await db
    .select()
    .from(phaseDependency)
    .where(inArray(phaseDependency.phaseId, phases.map((p) => p.id)));
  return phases.map((p) => ({ ...p, dependsOn: deps.filter((d) => d.phaseId === p.id).map((d) => d.dependsOnId) }));
}

/**
 * Adds a phase after the existing ones. Editor or higher.
 *
 * @throws InvalidError if a dependency is not a phase of this project
 */
export async function createPhase(db: Db, actor: Actor, slug: string, raw: z.input<typeof phaseInput>): Promise<PhaseItem> {
  const input = phaseInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    if (input.dependsOn.length > 0) {
      const found = await tx
        .select({ id: phase.id })
        .from(phase)
        .where(and(eq(phase.projectId, project.id), inArray(phase.id, input.dependsOn)));
      const missing = input.dependsOn.find((id) => !found.some((f) => f.id === id));
      if (missing) throw new InvalidError(`Unknown phase ${missing}.`);
    }
    const [{ last }] = await tx.select({ last: max(phase.sortOrder) }).from(phase).where(eq(phase.projectId, project.id));
    const [row] = await tx
      .insert(phase)
      .values({ id: newId(), projectId: project.id, name: input.name, goal: input.goal, sortOrder: (last ?? -1) + 1 })
      .returning();
    if (input.dependsOn.length > 0) {
      await tx.insert(phaseDependency).values(input.dependsOn.map((d) => ({ phaseId: row.id, dependsOnId: d })));
    }
    await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: row.id, field: "created", newValue: row.name });
    return { ...row, dependsOn: input.dependsOn };
  });
}

/** Deletes a phase and its dependency edges; its systems keep existing without a phase. Editor or higher. */
export async function deletePhase(db: Db, actor: Actor, slug: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const deleted = await tx
      .delete(phase)
      .where(and(eq(phase.id, id), eq(phase.projectId, project.id)))
      .returning({ name: phase.name });
    if (deleted.length === 0) throw new NotFoundError(`Unknown phase ${id}.`);
    await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: id, field: "deleted", oldValue: deleted[0].name });
  });
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/lib/ops/structure.test.ts
git add -A
git commit -m "feat: Add domain and phase ops"
```

---

### Task 3.5: Systems

**Files:**
- Create: `src/lib/ops/systems.ts`
- Test: `src/lib/ops/systems.test.ts`

**Interfaces:**
- Produces:
  - `createSystemInput` (zod `{ slug, title, summary, board?, domainId, phaseId, priority }`), `systemFilter` (zod `{ board?, domain?, phase?, category?, priority?, owner? }`), `updateSystemInput` (zod `{ title?, summary?, priority?, ownerUserId?, notes?, domainId?, phaseId? }`), `moveSystemInput` (zod `{ board?, column }`)
  - `createSystem(db: Db, actor: Actor, projectSlug: string, raw): Promise<SystemRow>` (editor) — lands in the board's planning column
  - `interface SystemListItem { id; slug; title; summary; priority: Priority; boardSlug; boardName; columnId; columnName; columnCategory: ColumnCategory; domainId: string | null; phaseId: string | null; ownerUserId: string | null; ownerName: string | null; planningComplete: boolean; tasksTotal: number; tasksDone: number }`
  - `listSystems(db: Executor, actor: Actor, projectSlug: string, raw?): Promise<SystemListItem[]>` (viewer)
  - `interface TaskItem { id: number; title: string; state: TaskState; priority: Priority; ownerUserId: string | null; ownerName: string | null; planStep: number | null }`
  - `interface SystemDetail { project: ProjectRow; role: AccessRole; system: SystemRow; board: BoardWithColumns; column: BoardColumnRow; domain: DomainRow | null; phase: PhaseRow | null; ownerName: string | null; tasks: TaskItem[] }`
  - `getSystem(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemDetail>` (viewer)
  - `updateSystem(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<SystemRow>` (editor)
  - `moveSystem(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<SystemRow>` (editor) — the planning gate
  - `planningGateMessage(systemSlug: string, gaps: string[]): string` — Part 4 passes real gaps
  - `claimSystem(tx: Executor, actor: Actor, parent: SystemRow): Promise<void>` — sets an unowned system's owner to the actor (logged); used by `moveSystem` (into an `active` column) and `updateTask` (state `doing`)

- [ ] **Step 1: Write the failing test**

`src/lib/ops/systems.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { changeLog } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { createBoard } from "./boards";
import { createDomain } from "./structure";
import { createSystem, getSystem, listSystems, moveSystem, updateSystem } from "./systems";

describe("createSystem", () => {
  it("puts a new system into the planning column of the first board by default", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "launcher", title: "Launcher" });
    const detail = await getSystem(db, owner, slug, "launcher");
    expect([detail.board.slug, detail.column.category, detail.system.priority]).toEqual(["development", "planning", "Later"]);
  });

  it("uses the named board and rejects taken slugs and foreign domains", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    const foreignDomain = await createDomain(db, other.owner, "other", { name: "X" });
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await createSystem(db, owner, slug, { slug: "spawn", title: "Spawn", board: "building" });
    expect((await getSystem(db, owner, slug, "spawn")).board.slug).toBe("building");
    await expect(createSystem(db, owner, slug, { slug: "spawn", title: "Again" })).rejects.toMatchObject({
      status: 409,
      message: "System slug spawn is taken in this project.",
    });
    await expect(createSystem(db, owner, slug, { slug: "x", title: "X", domainId: foreignDomain.id })).rejects.toMatchObject({
      status: 400,
      message: `Unknown domain ${foreignDomain.id}.`,
    });
  });

  it("needs the editor role", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(createSystem(db, viewer, slug, { slug: "x", title: "X" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("listSystems", () => {
  it("filters by board, column category and owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B", board: "building" });
    await updateSystem(db, owner, slug, "b", { ownerUserId: owner.userId });
    await completePlanningFixture(db, b.id);
    await moveSystem(db, owner, slug, "b", { column: "todo" });
    expect((await listSystems(db, owner, slug, { board: "building" })).map((s) => s.slug)).toEqual(["b"]);
    expect((await listSystems(db, owner, slug, { category: "planning" })).map((s) => s.slug)).toEqual(["a"]);
    expect((await listSystems(db, owner, slug, { owner: "none" })).map((s) => s.slug)).toEqual(["a"]);
    const [row] = await listSystems(db, owner, slug, { owner: owner.userId });
    expect(row).toMatchObject({ slug: "b", ownerName: "Owner", columnName: "Todo", planningComplete: true, tasksTotal: 0 });
  });
});

describe("moveSystem", () => {
  it("keeps a system in planning until planning is complete", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(moveSystem(db, owner, slug, "s", { column: "In progress" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("System s is still in planning."),
    });
  });

  it("moves by column name or id after planning and logs the move", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    await moveSystem(db, owner, slug, "s", { column: "in progress" });
    const detail = await getSystem(db, owner, slug, "s");
    expect(detail.column.name).toBe("In progress");
    await moveSystem(db, owner, slug, "s", { column: detail.board.columns[5].id });
    expect((await getSystem(db, owner, slug, "s")).column.name).toBe("Done");
    const moves = (await db.select().from(changeLog)).filter((c) => c.field === "column");
    expect(moves.map((m) => m.newValue)).toEqual(["Development / In progress", "Development / Done"]);
    expect(moves.every((m) => m.systemId === s.id)).toBe(true);
  });

  it("makes the mover owner when an unowned system enters an active column, never replacing an owner", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await completePlanningFixture(db, a.id);
    await completePlanningFixture(db, b.id);
    await moveSystem(db, editor, slug, "a", { column: "Todo" });
    expect((await getSystem(db, owner, slug, "a")).ownerName).toBeNull();
    await moveSystem(db, editor, slug, "a", { column: "In progress" });
    expect((await getSystem(db, owner, slug, "a")).ownerName).toBe("editor member");
    await updateSystem(db, owner, slug, "b", { ownerUserId: owner.userId });
    await moveSystem(db, editor, slug, "b", { column: "In progress" });
    expect((await getSystem(db, owner, slug, "b")).ownerName).toBe("Owner");
  });

  it("only accepts columns of the target board", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const building = await createBoard(db, owner, slug, { slug: "building", name: "Building" });
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    await expect(moveSystem(db, owner, slug, "s", { column: building.columns[1].id })).rejects.toMatchObject({
      status: 400,
      message: 'Board development has no column "' + building.columns[1].id + '". Columns: Planning, Todo, In progress, Review, Blocked, Done.',
    });
    await moveSystem(db, owner, slug, "s", { board: "building", column: building.columns[1].id });
    expect((await getSystem(db, owner, slug, "s")).board.slug).toBe("building");
  });
});

describe("updateSystem", () => {
  it("only assigns project members as owner and logs owner changes by name", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const outsider = await insertUser(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(updateSystem(db, owner, slug, "s", { ownerUserId: outsider.userId })).rejects.toMatchObject({
      status: 400,
      message: `User ${outsider.userId} is not a member of this project.`,
    });
    await updateSystem(db, owner, slug, "s", { ownerUserId: owner.userId, notes: "n", priority: "MVP" });
    const fields = (await db.select().from(changeLog)).filter((c) => c.entity === "system").map((c) => [c.field, c.newValue]);
    expect(fields).toEqual([
      ["created", "S"],
      ["priority", "MVP"],
      ["owner", "Owner"],
      ["notes", "n"],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/systems.test.ts`
Expected: FAIL, `./systems` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/systems.ts`:

```ts
import { and, asc, count, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  board,
  boardColumn,
  COLUMN_CATEGORIES,
  domain,
  phase,
  PRIORITIES,
  system,
  task,
  user,
  type ColumnCategory,
  type Priority,
  type TaskState,
} from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, isUniqueViolation, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findBoard, findSystem, loadBoards, userName, type BoardColumnRow, type BoardWithColumns, type SystemRow } from "./lookup";
import { isMember } from "./members";
import type { DomainRow, PhaseRow } from "./structure";

/** Input of {@link createSystem}. */
export const createSystemInput = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(""),
  board: slugSchema.optional(),
  domainId: z.string().nullable().default(null),
  phaseId: z.string().nullable().default(null),
  priority: z.enum(PRIORITIES).default("Later"),
});

/** Filters of {@link listSystems}; `owner` is a user id or `none`. */
export const systemFilter = z.object({
  board: z.string().optional(),
  domain: z.string().optional(),
  phase: z.string().optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner: z.string().optional(),
});

/** Input of {@link updateSystem}; omitted fields stay unchanged. */
export const updateSystemInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: z.string().nullable().optional(),
  notes: z.string().max(20000).optional(),
  domainId: z.string().nullable().optional(),
  phaseId: z.string().nullable().optional(),
});

/** Input of {@link moveSystem}: a column id or name, on `board` or the current board. */
export const moveSystemInput = z.object({ board: slugSchema.optional(), column: z.string().trim().min(1) });

/** A system as listed in catalogues and boards. */
export interface SystemListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  priority: Priority;
  boardSlug: string;
  boardName: string;
  columnId: string;
  columnName: string;
  columnCategory: ColumnCategory;
  domainId: string | null;
  phaseId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  planningComplete: boolean;
  tasksTotal: number;
  tasksDone: number;
}

/** A task as shown on its system. */
export interface TaskItem {
  id: number;
  title: string;
  state: TaskState;
  priority: Priority;
  ownerUserId: string | null;
  ownerName: string | null;
  planStep: number | null;
}

/** One system with its board, column, structure, owner and tasks. */
export interface SystemDetail {
  project: ProjectRow;
  role: AccessRole;
  system: SystemRow;
  board: BoardWithColumns;
  column: BoardColumnRow;
  domain: DomainRow | null;
  phase: PhaseRow | null;
  ownerName: string | null;
  tasks: TaskItem[];
}

/**
 * Returns the message of a blocked move out of planning, listing what is
 * still missing when `gaps` is given.
 */
export function planningGateMessage(systemSlug: string, gaps: string[]): string {
  const head = `System ${systemSlug} is still in planning. Finish the planning interview and call complete_planning first.`;
  return gaps.length ? `${head} Missing: ${gaps.join(" ")}` : head;
}

/**
 * Makes the actor the owner of a system that has none, logging the change.
 * Used when someone starts working on the system.
 */
export async function claimSystem(tx: Executor, actor: Actor, parent: SystemRow): Promise<void> {
  if (parent.ownerUserId !== null) return;
  await tx.update(system).set({ ownerUserId: actor.userId }).where(eq(system.id, parent.id));
  await logChange(tx, actor, {
    projectId: parent.projectId,
    systemId: parent.id,
    entity: "system",
    entityId: parent.id,
    field: "owner",
    oldValue: null,
    newValue: actor.name,
  });
}

/** Throws unless the domain and phase ids (when set) belong to the project. */
async function checkStructure(tx: Executor, projectId: string, domainId?: string | null, phaseId?: string | null): Promise<void> {
  if (domainId) {
    const rows = await tx.select({ id: domain.id }).from(domain).where(and(eq(domain.id, domainId), eq(domain.projectId, projectId)));
    if (rows.length === 0) throw new InvalidError(`Unknown domain ${domainId}.`);
  }
  if (phaseId) {
    const rows = await tx.select({ id: phase.id }).from(phase).where(and(eq(phase.id, phaseId), eq(phase.projectId, projectId)));
    if (rows.length === 0) throw new InvalidError(`Unknown phase ${phaseId}.`);
  }
}

/**
 * Creates a system in the planning column of `board` (default: the first board). Editor or higher.
 *
 * @throws ConflictError if the slug is taken in this project
 * @throws InvalidError if the domain or phase is not in this project
 */
export async function createSystem(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createSystemInput>): Promise<SystemRow> {
  const input = createSystemInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "editor");
      const target = input.board ? await findBoard(tx, project.id, input.board) : (await loadBoards(tx, project.id))[0];
      if (!target) throw new NotFoundError(`Project ${projectSlug} has no board.`);
      const planning = target.columns.find((c) => c.category === "planning");
      if (!planning) throw new ConflictError(`Board ${target.slug} has no planning column.`);
      await checkStructure(tx, project.id, input.domainId, input.phaseId);
      const [{ last }] = await tx.select({ last: max(system.sortOrder) }).from(system).where(eq(system.projectId, project.id));
      const [row] = await tx
        .insert(system)
        .values({
          id: newId(),
          projectId: project.id,
          boardId: target.id,
          columnId: planning.id,
          domainId: input.domainId,
          phaseId: input.phaseId,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          priority: input.priority,
          sortOrder: (last ?? -1) + 1,
        })
        .returning();
      await logChange(tx, actor, { projectId: project.id, systemId: row.id, entity: "system", entityId: row.id, field: "created", newValue: row.title });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`System slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/** Lists the project's systems matching `filter`, by board order then system order, with task counts. */
export async function listSystems(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof systemFilter> = {},
): Promise<SystemListItem[]> {
  const filter = systemFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const conditions: SQL[] = [eq(system.projectId, project.id)];
  if (filter.board) conditions.push(eq(board.slug, filter.board));
  if (filter.domain) conditions.push(eq(system.domainId, filter.domain));
  if (filter.phase) conditions.push(eq(system.phaseId, filter.phase));
  if (filter.category) conditions.push(eq(boardColumn.category, filter.category));
  if (filter.priority) conditions.push(eq(system.priority, filter.priority));
  if (filter.owner === "none") conditions.push(isNull(system.ownerUserId));
  else if (filter.owner) conditions.push(eq(system.ownerUserId, filter.owner));

  const rows = await db
    .select({
      id: system.id,
      slug: system.slug,
      title: system.title,
      summary: system.summary,
      priority: system.priority,
      boardSlug: board.slug,
      boardName: board.name,
      columnId: boardColumn.id,
      columnName: boardColumn.name,
      columnCategory: boardColumn.category,
      domainId: system.domainId,
      phaseId: system.phaseId,
      ownerUserId: system.ownerUserId,
      ownerName: user.name,
      planningCompletedAt: system.planningCompletedAt,
    })
    .from(system)
    .innerJoin(board, eq(board.id, system.boardId))
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .leftJoin(user, eq(user.id, system.ownerUserId))
    .where(and(...conditions))
    .orderBy(asc(board.sortOrder), asc(system.sortOrder));

  const counts = await db
    .select({
      systemId: task.systemId,
      total: count(),
      done: sql<number>`count(*) filter (where ${task.state} = 'done')`.mapWith(Number),
    })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(eq(system.projectId, project.id))
    .groupBy(task.systemId);
  const bySystem = new Map(counts.map((c) => [c.systemId, c]));

  return rows.map(({ planningCompletedAt, ...r }) => ({
    ...r,
    planningComplete: planningCompletedAt !== null,
    tasksTotal: bySystem.get(r.id)?.total ?? 0,
    tasksDone: bySystem.get(r.id)?.done ?? 0,
  }));
}

/** Returns one system with its board, column, domain, phase, owner and tasks. */
export async function getSystem(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemDetail> {
  const found = await projectAccess(db, actor, projectSlug, "viewer");
  const row = await findSystem(db, found.project.id, systemSlug);
  const boards = await loadBoards(db, found.project.id);
  const currentBoard = boards.find((b) => b.id === row.boardId) as BoardWithColumns;
  const column = currentBoard.columns.find((c) => c.id === row.columnId) as BoardColumnRow;
  const [domainRow] = row.domainId ? await db.select().from(domain).where(eq(domain.id, row.domainId)) : [];
  const [phaseRow] = row.phaseId ? await db.select().from(phase).where(eq(phase.id, row.phaseId)) : [];
  const tasks = await db
    .select({
      id: task.id,
      title: task.title,
      state: task.state,
      priority: task.priority,
      ownerUserId: task.ownerUserId,
      ownerName: user.name,
      planStep: task.planStep,
    })
    .from(task)
    .leftJoin(user, eq(user.id, task.ownerUserId))
    .where(eq(task.systemId, row.id))
    .orderBy(asc(task.sortOrder), asc(task.id));
  return {
    ...found,
    system: row,
    board: currentBoard,
    column,
    domain: domainRow ?? null,
    phase: phaseRow ?? null,
    ownerName: await userName(db, row.ownerUserId),
    tasks,
  };
}

/**
 * Changes a system's fields and logs each changed one (the owner by name). Editor or higher.
 *
 * @throws InvalidError if the owner is not a project member, or the domain or phase is foreign
 */
export async function updateSystem(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof updateSystemInput>,
): Promise<SystemRow> {
  const patch = updateSystemInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    if (patch.ownerUserId && !(await isMember(tx, project.id, patch.ownerUserId))) {
      throw new InvalidError(`User ${patch.ownerUserId} is not a member of this project.`);
    }
    await checkStructure(tx, project.id, patch.domainId, patch.phaseId);
    const changes: Partial<SystemRow> = {};
    for (const field of ["title", "summary", "priority", "ownerUserId", "notes", "domainId", "phaseId"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      const owner = field === "ownerUserId";
      await logChange(tx, actor, {
        projectId: project.id,
        systemId: current.id,
        entity: "system",
        entityId: current.id,
        field: owner ? "owner" : field,
        oldValue: owner ? await userName(tx, current.ownerUserId) : current[field],
        newValue: owner ? await userName(tx, next as string | null) : (next as string | null),
      });
    }
    if (Object.keys(changes).length === 0) return current;
    const [row] = await tx.update(system).set(changes).where(eq(system.id, current.id)).returning();
    return row;
  });
}

/**
 * Moves a system to a column (by id or case-insensitive name) of `board` or its
 * current board. Leaving the planning column requires completed planning. Moving
 * into an `active` column makes the actor (when a project member) owner of an
 * unowned system. Editor or higher.
 *
 * @throws InvalidError if the board has no such column
 * @throws ConflictError if planning is not complete
 */
export async function moveSystem(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof moveSystemInput>,
): Promise<SystemRow> {
  const input = moveSystemInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    const boards = await loadBoards(tx, project.id);
    const from = boards.find((b) => b.id === current.boardId) as BoardWithColumns;
    const to = input.board ? await findBoard(tx, project.id, input.board) : from;
    const wanted = input.column.toLowerCase();
    const column = to.columns.find((c) => c.id === input.column || c.name.toLowerCase() === wanted);
    if (!column) {
      throw new InvalidError(`Board ${to.slug} has no column "${input.column}". Columns: ${to.columns.map((c) => c.name).join(", ")}.`);
    }
    if (column.category !== "planning" && !current.planningCompletedAt) {
      throw new ConflictError(planningGateMessage(current.slug, []));
    }
    if (column.id === current.columnId) return current;
    if (column.category === "active" && (await isMember(tx, project.id, actor.userId))) {
      await claimSystem(tx, actor, current);
    }
    const fromColumn = from.columns.find((c) => c.id === current.columnId);
    const [row] = await tx.update(system).set({ boardId: to.id, columnId: column.id }).where(eq(system.id, current.id)).returning();
    await logChange(tx, actor, {
      projectId: project.id,
      systemId: current.id,
      entity: "system",
      entityId: current.id,
      field: "column",
      oldValue: `${from.name} / ${fromColumn?.name}`,
      newValue: `${to.name} / ${column.name}`,
    });
    return row;
  });
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/lib/ops/systems.test.ts
git add -A
git commit -m "feat: Add system ops with the planning column gate"
```

Expected: all systems tests pass.

---

### Task 3.6: Tasks, progress updates, questions and activity

**Files:**
- Create: `src/lib/ops/tasks.ts`, `src/lib/ops/updates.ts`, `src/lib/ops/questions.ts`, `src/lib/ops/activity.ts`
- Test: `src/lib/ops/tasks.test.ts`, `src/lib/ops/updates.test.ts`, `src/lib/ops/questions.test.ts`, `src/lib/ops/activity.test.ts`

**Interfaces:**
- Produces:
  - `addTaskInput` (zod `{ title, priority? }`), `updateTaskInput` (zod `{ title?, state?, priority?, ownerUserId? }`)
  - `addTask(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<{ id: number }>` (editor)
  - `updateTask(db: Db, actor: Actor, taskId: number, raw): Promise<void>` (editor; `doing`/`done` need completed planning; `doing` assigns the actor as owner of an unowned task and, through `claimSystem`, of an unowned system)
  - `deleteTask(db: Db, actor: Actor, taskId: number): Promise<void>` (editor)
  - `postUpdateInput` (zod `{ summary, nextStep?, taskId?, commit? }`), `listUpdatesInput` (zod `{ system?, limit }`)
  - `commitUrl(repoUrl: string | null, hash: string | null): string | null`
  - `postUpdate(db: Db, actor: Actor, projectSlug: string, systemSlug: string, raw): Promise<{ id: string; commitUrl: string | null }>` (editor)
  - `interface UpdateItem { id: string; systemSlug: string; systemTitle: string; taskId: number | null; taskTitle: string | null; summary: string; nextStep: string | null; commitHash: string | null; commitUrl: string | null; author: string; isAgent: boolean; createdAt: Date }`
  - `listUpdates(db: Executor, actor: Actor, projectSlug: string, raw?): Promise<UpdateItem[]>` (viewer, newest first)
  - `latestUpdates(db: Executor, projectId: string): Promise<Map<string, { summary: string; createdAt: Date }>>` (keyed by system id)
  - `addQuestionInput` (zod `{ title, text, system? }`), `answerQuestionInput` (zod `{ id, answer, resolved }`), `questionFilter` (zod `{ system?, resolved? }`)
  - `addQuestion(db: Db, actor, projectSlug, raw): Promise<{ id: string }>`; `answerQuestion(db: Db, actor, projectSlug, raw): Promise<void>`; `setQuestionResolved(db: Db, actor, projectSlug, id: string, resolved: boolean): Promise<void>` (all editor)
  - `interface QuestionItem { id: string; title: string; text: string; answer: string | null; resolved: boolean; systemSlug: string | null; systemTitle: string | null; author: string; createdAt: Date; resolvedAt: Date | null }`; `listQuestions(db: Executor, actor, projectSlug, raw?): Promise<QuestionItem[]>` (viewer; unresolved first, newest first)
  - `interface HistoryEntry { id: number; entity: string; entityId: string; field: string; oldValue: string | null; newValue: string | null; author: string; createdAt: Date }`; `listActivity(db: Executor, actor, projectSlug, raw?: { system?: string; limit?: number }): Promise<HistoryEntry[]>` (viewer, newest first)

- [ ] **Step 1: Write the failing tests**

`src/lib/ops/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { withAgent } from "./actor";
import { createSystem, getSystem, updateSystem } from "./systems";
import { addTask, deleteTask, updateTask } from "./tasks";

describe("tasks", () => {
  it("adds tasks at the end with the system's priority", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S", priority: "MVP" });
    await addTask(db, owner, slug, "s", { title: "First" });
    await addTask(db, owner, slug, "s", { title: "Second", priority: "Later" });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks.map((t) => [t.title, t.priority, t.state])).toEqual([
      ["First", "MVP", "todo"],
      ["Second", "Later", "todo"],
    ]);
  });

  it("blocks doing and done while the system is in planning", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await expect(updateTask(db, owner, id, { state: "doing" })).rejects.toMatchObject({
      status: 409,
      message: `Task ${id} cannot be doing while system s is still in planning.`,
    });
    await updateTask(db, owner, id, { state: "blocked" });
    await completePlanningFixture(db, s.id);
    await updateTask(db, owner, id, { state: "done", title: "Renamed" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0]).toMatchObject({ state: "done", title: "Renamed" });
  });

  it("assigns the task and the system to whoever starts the task, keeping existing owners", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const first = await addTask(db, owner, slug, "s", { title: "First" });
    const second = await addTask(db, owner, slug, "s", { title: "Second" });
    await updateTask(db, owner, second.id, { ownerUserId: owner.userId });

    await updateTask(db, withAgent(editor, "Claude Code"), first.id, { state: "doing" });
    await updateTask(db, editor, second.id, { state: "doing" });

    const detail = await getSystem(db, owner, slug, "s");
    expect(detail.tasks.map((t) => [t.title, t.ownerName])).toEqual([
      ["First", "editor member"],
      ["Second", "Owner"],
    ]);
    expect(detail.ownerName).toBe("editor member");
  });

  it("does not assign admins who are not project members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await updateTask(db, admin, id, { state: "doing" });
    const detail = await getSystem(db, owner, slug, "s");
    expect([detail.tasks[0].ownerName, detail.ownerName]).toEqual([null, null]);
  });

  it("hides tasks of projects the actor cannot see and deletes tasks", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await expect(updateTask(db, other.owner, id, { title: "x" })).rejects.toMatchObject({ status: 404, message: `Unknown task ${id}.` });
    await updateSystem(db, owner, slug, "s", { notes: "keep" });
    await deleteTask(db, owner, id);
    expect((await getSystem(db, owner, slug, "s")).tasks).toEqual([]);
  });
});
```

`src/lib/ops/updates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
import { updateProject } from "./projects";
import { createSystem } from "./systems";
import { addTask } from "./tasks";
import { commitUrl, latestUpdates, listUpdates, postUpdate } from "./updates";

describe("commitUrl", () => {
  it("joins the repository URL and hash", () => {
    expect(commitUrl("https://github.com/x/y/", "abc1234")).toBe("https://github.com/x/y/commit/abc1234");
    expect(commitUrl(null, "abc1234")).toBeNull();
    expect(commitUrl("https://github.com/x/y", null)).toBeNull();
  });
});

describe("progress updates", () => {
  it("stores updates with task, commit and agent, newest first", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await updateProject(db, owner, slug, { repoUrl: "https://github.com/x/y" });
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id: taskId } = await addTask(db, owner, slug, "s", { title: "T" });
    await postUpdate(db, owner, slug, "s", { summary: "First" });
    const posted = await postUpdate(db, withAgent(owner, "Claude Code"), slug, "s", { summary: "Second", taskId, commit: "ABCDEF1" });
    expect(posted.commitUrl).toBe("https://github.com/x/y/commit/abcdef1");
    const updates = await listUpdates(db, owner, slug, { system: "s" });
    expect(updates.map((u) => [u.summary, u.author, u.isAgent, u.taskTitle])).toEqual([
      ["Second", "Claude Code (for Owner)", true, "T"],
      ["First", "Owner", false, null],
    ]);
    expect([...(await latestUpdates(db, projectId)).values()].map((u) => u.summary)).toEqual(["Second"]);
  });

  it("rejects bad commit hashes and tasks of other systems", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const { id } = await addTask(db, owner, slug, "b", { title: "T" });
    await expect(postUpdate(db, owner, slug, "a", { summary: "x", commit: "xyz" })).rejects.toThrow(/commit/);
    await expect(postUpdate(db, owner, slug, "a", { summary: "x", taskId: id })).rejects.toMatchObject({
      status: 400,
      message: `Task ${id} does not belong to system a.`,
    });
  });
});
```

`src/lib/ops/questions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { addQuestion, answerQuestion, listQuestions, setQuestionResolved } from "./questions";
import { createSystem } from "./systems";

describe("questions", () => {
  it("adds, answers and lists questions with unresolved first", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const a = await addQuestion(db, owner, slug, { title: "A?", system: "s" });
    await addQuestion(db, owner, slug, { title: "B?" });
    await answerQuestion(db, owner, slug, { id: a.id, answer: "Yes" });
    const all = await listQuestions(db, owner, slug);
    expect(all.map((q) => [q.title, q.resolved, q.answer, q.systemSlug])).toEqual([
      ["B?", false, null, null],
      ["A?", true, "Yes", "s"],
    ]);
    expect((await listQuestions(db, owner, slug, { system: "s" })).map((q) => q.title)).toEqual(["A?"]);
    await setQuestionResolved(db, owner, slug, a.id, false);
    expect((await listQuestions(db, owner, slug, { resolved: false })).map((q) => q.title).sort()).toEqual(["A?", "B?"]);
  });

  it("rejects unknown systems and questions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await expect(addQuestion(db, owner, slug, { title: "A?", system: "nope" })).rejects.toMatchObject({ status: 404 });
    await expect(answerQuestion(db, owner, slug, { id: "q", answer: "x" })).rejects.toMatchObject({ status: 404, message: "Unknown question q." });
  });
});
```

`src/lib/ops/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { listActivity } from "./activity";
import { createSystem, updateSystem } from "./systems";
import { addTask } from "./tasks";

describe("listActivity", () => {
  it("lists project changes newest first and narrows to one system's history", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await addTask(db, owner, slug, "a", { title: "T" });
    await updateSystem(db, owner, slug, "a", { notes: "n" });
    const all = await listActivity(db, owner, slug);
    expect(all[0]).toMatchObject({ entity: "system", field: "notes", author: "Owner" });
    expect(all.at(-1)).toMatchObject({ entity: "project", field: "created" });
    const history = await listActivity(db, owner, slug, { system: "a" });
    expect(history.map((h) => `${h.entity}:${h.field}`)).toEqual(["system:notes", "task:created", "system:created"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/ops/tasks.test.ts src/lib/ops/updates.test.ts src/lib/ops/questions.test.ts src/lib/ops/activity.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement tasks**

`src/lib/ops/tasks.ts`:

```ts
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { PRIORITIES, system, task, TASK_STATES } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccessById } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { systemAccess, userName } from "./lookup";
import { isMember } from "./members";
import { claimSystem } from "./systems";

/** Input of {@link addTask}. */
export const addTaskInput = z.object({ title: z.string().trim().min(1).max(200), priority: z.enum(PRIORITIES).optional() });

/** Input of {@link updateTask}; omitted fields stay unchanged. */
export const updateTaskInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  state: z.enum(TASK_STATES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: z.string().nullable().optional(),
});

/** Loads a task with its system and checks the actor's role in its project. */
async function taskAccess(tx: Executor, actor: Actor, taskId: number) {
  const [row] = await tx
    .select({ task, system })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(eq(task.id, taskId))
    .limit(1);
  if (!row) throw new NotFoundError(`Unknown task ${taskId}.`);
  try {
    await projectAccessById(tx, actor, row.system.projectId, "editor");
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError(`Unknown task ${taskId}.`);
    throw error;
  }
  return row;
}

/** Adds a task at the end of a system's list; priority defaults to the system's. Editor or higher. */
export async function addTask(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof addTaskInput>,
): Promise<{ id: number }> {
  const input = addTaskInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project, system: parent } = await systemAccess(tx, actor, projectSlug, systemSlug, "editor");
    const [{ last }] = await tx.select({ last: max(task.sortOrder) }).from(task).where(eq(task.systemId, parent.id));
    const [row] = await tx
      .insert(task)
      .values({ systemId: parent.id, title: input.title, priority: input.priority ?? parent.priority, sortOrder: (last ?? -1) + 1 })
      .returning({ id: task.id });
    await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: row.id, field: "created", newValue: input.title });
    return row;
  });
}

/**
 * Changes a task and logs each changed field. Editor or higher. Setting `doing`
 * assigns the actor (when they are a project member) as owner of an unowned
 * task and of the unowned system; existing owners are never replaced.
 *
 * @throws ConflictError when setting `doing` or `done` while the system is in planning
 * @throws InvalidError if the owner is not a project member
 */
export async function updateTask(db: Db, actor: Actor, taskId: number, raw: z.input<typeof updateTaskInput>): Promise<void> {
  const patch = updateTaskInput.parse(raw);
  await db.transaction(async (tx) => {
    const { task: current, system: parent } = await taskAccess(tx, actor, taskId);
    if ((patch.state === "doing" || patch.state === "done") && !parent.planningCompletedAt) {
      throw new ConflictError(`Task ${taskId} cannot be ${patch.state} while system ${parent.slug} is still in planning.`);
    }
    if (patch.ownerUserId && !(await isMember(tx, parent.projectId, patch.ownerUserId))) {
      throw new InvalidError(`User ${patch.ownerUserId} is not a member of this project.`);
    }
    if (patch.state === "doing" && (await isMember(tx, parent.projectId, actor.userId))) {
      if (patch.ownerUserId === undefined && current.ownerUserId === null) patch.ownerUserId = actor.userId;
      await claimSystem(tx, actor, parent);
    }
    const changes: Partial<typeof task.$inferSelect> = {};
    for (const field of ["title", "state", "priority", "ownerUserId"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      const owner = field === "ownerUserId";
      await logChange(tx, actor, {
        projectId: parent.projectId,
        systemId: parent.id,
        entity: "task",
        entityId: taskId,
        field: owner ? "owner" : field,
        oldValue: owner ? await userName(tx, current.ownerUserId) : current[field],
        newValue: owner ? await userName(tx, next as string | null) : (next as string | null),
      });
    }
    if (Object.keys(changes).length > 0) await tx.update(task).set(changes).where(eq(task.id, taskId));
  });
}

/** Deletes a task and logs its title. Editor or higher. */
export async function deleteTask(db: Db, actor: Actor, taskId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { task: current, system: parent } = await taskAccess(tx, actor, taskId);
    await tx.delete(task).where(eq(task.id, taskId));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "task", entityId: taskId, field: "deleted", oldValue: current.title });
  });
}
```

- [ ] **Step 4: Implement updates, questions and activity**

`src/lib/ops/updates.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { progressUpdate, system, task, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { InvalidError } from "./errors";
import { logChange } from "./log";
import { findSystem, systemAccess } from "./lookup";

/** Input of {@link postUpdate}. */
export const postUpdateInput = z.object({
  summary: z.string().trim().min(1).max(5000),
  nextStep: z.string().trim().max(2000).optional(),
  taskId: z.number().int().optional(),
  commit: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{7,40}$/, "commit must be a 7 to 40 character hex hash")
    .optional(),
});

/** Filters of {@link listUpdates}. */
export const listUpdatesInput = z.object({ system: z.string().optional(), limit: z.number().int().min(1).max(500).default(50) });

/** A progress update as shown in feeds and on systems. */
export interface UpdateItem {
  id: string;
  systemSlug: string;
  systemTitle: string;
  taskId: number | null;
  taskTitle: string | null;
  summary: string;
  nextStep: string | null;
  commitHash: string | null;
  commitUrl: string | null;
  author: string;
  isAgent: boolean;
  createdAt: Date;
}

/** Returns the web URL of a commit in the project's repository, or `null` without both parts. */
export function commitUrl(repoUrl: string | null, hash: string | null): string | null {
  return repoUrl && hash ? `${repoUrl.replace(/\/+$/, "")}/commit/${hash}` : null;
}

/**
 * Posts a progress update on a system. Editor or higher.
 *
 * @throws InvalidError if the task belongs to another system
 */
export async function postUpdate(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof postUpdateInput>,
): Promise<{ id: string; commitUrl: string | null }> {
  const input = postUpdateInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project, system: parent } = await systemAccess(tx, actor, projectSlug, systemSlug, "editor");
    if (input.taskId !== undefined) {
      const rows = await tx.select({ id: task.id }).from(task).where(and(eq(task.id, input.taskId), eq(task.systemId, parent.id)));
      if (rows.length === 0) throw new InvalidError(`Task ${input.taskId} does not belong to system ${systemSlug}.`);
    }
    const id = newId();
    await tx.insert(progressUpdate).values({
      id,
      systemId: parent.id,
      taskId: input.taskId ?? null,
      summary: input.summary,
      nextStep: input.nextStep || null,
      commitHash: input.commit ?? null,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "update", entityId: id, field: "posted", newValue: input.summary });
    return { id, commitUrl: commitUrl(project.repoUrl, input.commit ?? null) };
  });
}

/** Lists progress updates of the project, or of one system, newest first. */
export async function listUpdates(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof listUpdatesInput> = {},
): Promise<UpdateItem[]> {
  const filter = listUpdatesInput.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const where = filter.system
    ? eq(progressUpdate.systemId, (await findSystem(db, project.id, filter.system)).id)
    : eq(system.projectId, project.id);
  const rows = await db
    .select({
      id: progressUpdate.id,
      systemSlug: system.slug,
      systemTitle: system.title,
      taskId: progressUpdate.taskId,
      taskTitle: task.title,
      summary: progressUpdate.summary,
      nextStep: progressUpdate.nextStep,
      commitHash: progressUpdate.commitHash,
      authorName: user.name,
      agent: progressUpdate.agent,
      createdAt: progressUpdate.createdAt,
    })
    .from(progressUpdate)
    .innerJoin(system, eq(system.id, progressUpdate.systemId))
    .leftJoin(task, eq(task.id, progressUpdate.taskId))
    .leftJoin(user, eq(user.id, progressUpdate.authorUserId))
    .where(where)
    .orderBy(desc(progressUpdate.createdAt), desc(progressUpdate.id))
    .limit(filter.limit);
  return rows.map(({ authorName, agent, ...r }) => ({
    ...r,
    commitUrl: commitUrl(project.repoUrl, r.commitHash),
    author: authorLabel(authorName, agent),
    isAgent: agent !== null,
  }));
}

/** Returns the newest update of every system in the project that has one, keyed by system id. */
export async function latestUpdates(db: Executor, projectId: string): Promise<Map<string, { summary: string; createdAt: Date }>> {
  const rows = await db
    .selectDistinctOn([progressUpdate.systemId], {
      systemId: progressUpdate.systemId,
      summary: progressUpdate.summary,
      createdAt: progressUpdate.createdAt,
    })
    .from(progressUpdate)
    .innerJoin(system, eq(system.id, progressUpdate.systemId))
    .where(eq(system.projectId, projectId))
    .orderBy(progressUpdate.systemId, desc(progressUpdate.createdAt), desc(progressUpdate.id));
  return new Map(rows.map((r) => [r.systemId, { summary: r.summary, createdAt: r.createdAt }]));
}
```

`src/lib/ops/questions.ts`:

```ts
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { question, system, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorLabel, type Actor } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem } from "./lookup";

/** Input of {@link addQuestion}. */
export const addQuestionInput = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().max(5000).default(""),
  system: slugSchema.optional(),
});

/** Input of {@link answerQuestion}. */
export const answerQuestionInput = z.object({
  id: z.string().min(1),
  answer: z.string().trim().min(1).max(5000),
  resolved: z.boolean().default(true),
});

/** Filters of {@link listQuestions}. */
export const questionFilter = z.object({ system: z.string().optional(), resolved: z.boolean().optional() });

/** An open question as listed. */
export interface QuestionItem {
  id: string;
  title: string;
  text: string;
  answer: string | null;
  resolved: boolean;
  systemSlug: string | null;
  systemTitle: string | null;
  author: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

/** Loads a question of the project for update or throws `NotFoundError`. */
async function findQuestion(tx: Executor, projectId: string, id: string) {
  const [row] = await tx
    .select()
    .from(question)
    .where(and(eq(question.id, id), eq(question.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError(`Unknown question ${id}.`);
  return row;
}

/** Adds an unresolved question, optionally tied to a system. Editor or higher. */
export async function addQuestion(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof addQuestionInput>): Promise<{ id: string }> {
  const input = addQuestionInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const parent = input.system ? await findSystem(tx, project.id, input.system) : null;
    const id = newId();
    await tx.insert(question).values({
      id,
      projectId: project.id,
      systemId: parent?.id ?? null,
      title: input.title,
      text: input.text,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent?.id, entity: "question", entityId: id, field: "created", newValue: input.title });
    return { id };
  });
}

/** Records the answer to a question and, by default, resolves it. Editor or higher. */
export async function answerQuestion(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof answerQuestionInput>): Promise<void> {
  const input = answerQuestionInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findQuestion(tx, project.id, input.id);
    await tx
      .update(question)
      .set({ answer: input.answer, resolved: input.resolved, resolvedAt: input.resolved ? new Date() : null })
      .where(eq(question.id, current.id));
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: current.id, field: "answer", oldValue: current.answer, newValue: input.answer });
  });
}

/** Marks a question resolved or unresolved. Editor or higher. */
export async function setQuestionResolved(db: Db, actor: Actor, projectSlug: string, id: string, resolved: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findQuestion(tx, project.id, id);
    if (current.resolved === resolved) return;
    await tx.update(question).set({ resolved, resolvedAt: resolved ? new Date() : null }).where(eq(question.id, id));
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: id, field: "resolved", oldValue: String(current.resolved), newValue: String(resolved) });
  });
}

/** Lists questions of the project, unresolved first, then newest first. */
export async function listQuestions(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof questionFilter> = {},
): Promise<QuestionItem[]> {
  const filter = questionFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const conditions: SQL[] = [eq(question.projectId, project.id)];
  if (filter.system) conditions.push(eq(question.systemId, (await findSystem(db, project.id, filter.system)).id));
  if (filter.resolved !== undefined) conditions.push(eq(question.resolved, filter.resolved));
  const rows = await db
    .select({
      id: question.id,
      title: question.title,
      text: question.text,
      answer: question.answer,
      resolved: question.resolved,
      systemSlug: system.slug,
      systemTitle: system.title,
      authorName: user.name,
      agent: question.agent,
      createdAt: question.createdAt,
      resolvedAt: question.resolvedAt,
    })
    .from(question)
    .leftJoin(system, eq(system.id, question.systemId))
    .leftJoin(user, eq(user.id, question.authorUserId))
    .where(and(...conditions))
    .orderBy(asc(question.resolved), desc(question.createdAt), desc(question.id));
  return rows.map(({ authorName, agent, ...r }) => ({ ...r, author: authorLabel(authorName, agent) }));
}
```

`src/lib/ops/activity.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { changeLog, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { findSystem } from "./lookup";

/** Filters of {@link listActivity}. */
export const activityFilter = z.object({ system: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) });

/** A change log entry as shown in history lists. */
export interface HistoryEntry {
  id: number;
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  author: string;
  createdAt: Date;
}

/** Lists the project's changes, or one system's history, newest first. */
export async function listActivity(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof activityFilter> = {},
): Promise<HistoryEntry[]> {
  const filter = activityFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const conditions = [eq(changeLog.projectId, project.id)];
  if (filter.system) conditions.push(eq(changeLog.systemId, (await findSystem(db, project.id, filter.system)).id));
  const rows = await db
    .select({
      id: changeLog.id,
      entity: changeLog.entity,
      entityId: changeLog.entityId,
      field: changeLog.field,
      oldValue: changeLog.oldValue,
      newValue: changeLog.newValue,
      authorName: user.name,
      agent: changeLog.agent,
      createdAt: changeLog.createdAt,
    })
    .from(changeLog)
    .leftJoin(user, eq(user.id, changeLog.authorUserId))
    .where(and(...conditions))
    .orderBy(desc(changeLog.id))
    .limit(filter.limit);
  return rows.map(({ authorName, agent, ...r }) => ({ ...r, author: authorLabel(authorName, agent) }));
}
```

- [ ] **Step 5: Run everything and commit**

```bash
npm test
npm run lint && npm run typecheck
git add -A
git commit -m "feat: Add task, progress update, question and activity ops"
```

Expected: the whole suite passes.
