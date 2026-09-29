# Part 6: Project UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** Every signed-in screen of spec section 7 on shadcn/ui: project list, project navigation with switcher, catalogue, boards (kanban, board tabs, column editor), roadmap, system page (task list above three closed accordions), ADRs, questions, updates, members, activity and settings.

**Spec:** section 7.

**Consumes:** every op from Parts 3–4, `runAction`/`ActionResult` and `requireActor` (Part 2), `Nav` (Part 2), shadcn components under `@/components/ui/*`, `.prose-md` and `bg-cat-*` utilities (Part 1).

UI conventions for every task:
- Server components load data through `pageData` (Task 6.1) and pass plain props (dates as ISO strings) to client components.
- Client components call server actions and report failures with `toast.error(result.error)`; they never throw.
- `canEdit` is `role !== "viewer"`; `canOwn` is `role === "owner" || role === "admin"`. Controls a role cannot use are rendered disabled or hidden, never enabled-then-rejected.
- All user and agent text that may contain markdown (specs, plans, ADR sections, answers, update summaries, question text) is rendered with `<Markdown>`.

---

### Task 6.1: Shared UI pieces: page loader, markdown, chips, lists

**Files:**
- Create: `src/lib/page.ts`, `src/components/markdown.tsx`, `src/components/chips.tsx`, `src/components/update-list.tsx`, `src/components/history-list.tsx`, `src/components/page-header.tsx`
- Test: `src/components/markdown.test.tsx`

**Interfaces:**
- Produces:
  - `pageData<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<T>` — runs as the signed-in actor; `NotFoundError` → Next `notFound()`
  - `<Markdown>{text}</Markdown>` — GitHub-flavoured markdown, raw HTML skipped, unsafe URLs removed
  - `CATEGORY_CLASS: Record<ColumnCategory, string>`, `<CategoryBadge category name />`, `<PriorityBadge priority />`, `<OwnerBadge name />`, `<TaskStateBadge state />`
  - `<UpdateList updates showSystem projectSlug />` with `UpdateView` (UpdateItem with `createdAt: string`)
  - `<HistoryList entries showEntity />` with `HistoryView` (HistoryEntry with `createdAt: string`)
  - `<PageHeader eyebrow title description actions />`
  - `toIso<T extends { createdAt: Date }>(row: T): Omit<T, "createdAt"> & { createdAt: string }`

- [ ] **Step 1: Write the failing markdown test**

`src/components/markdown.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders GitHub-flavoured markdown", () => {
    const html = renderToStaticMarkup(<Markdown>{"# Title\n\n- [x] done\n\n| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
  });

  it("drops raw HTML and neutralises javascript links", () => {
    const html = renderToStaticMarkup(
      <Markdown>{'<script>alert(1)</script><img src=x onerror="alert(2)">\n\n[click](javascript:alert(3))'}</Markdown>,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("opens links in a new tab without referrer", () => {
    const html = renderToStaticMarkup(<Markdown>{"[repo](https://github.com/x/y)"}</Markdown>);
    expect(html).toContain('href="https://github.com/x/y"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/markdown.test.tsx`
Expected: FAIL, `./markdown` not found.

- [ ] **Step 3: Implement the shared pieces**

`src/lib/page.ts`:

```ts
import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { requireActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/ops/actor";
import { NotFoundError } from "@/lib/ops/errors";

/**
 * Loads page data as the signed-in actor. Unknown or invisible entities render
 * the 404 page; other errors propagate to the error boundary.
 */
export async function pageData<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireActor();
  try {
    return await fn(getDb(), actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Returns a copy of `row` with `createdAt` as an ISO string, for client components. */
export function toIso<T extends { createdAt: Date }>(row: T): Omit<T, "createdAt"> & { createdAt: string } {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
```

`src/components/markdown.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders GitHub-flavoured markdown written by people or agents. Raw HTML is
 * skipped and unsafe URLs (such as `javascript:`) are removed by react-markdown's
 * default URL transform; links open in a new tab.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `prose-md ${className}` : "prose-md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

`src/components/chips.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { ColumnCategory, Priority, TaskState } from "@/db/schema";
import { cn } from "@/lib/utils";

/** Background class of each column category's colour dot (literal strings so Tailwind keeps them). */
export const CATEGORY_CLASS: Record<ColumnCategory, string> = {
  planning: "bg-cat-planning",
  todo: "bg-cat-todo",
  active: "bg-cat-active",
  review: "bg-cat-review",
  blocked: "bg-cat-blocked",
  done: "bg-cat-done",
};

/** A small round dot in a category's colour. */
export function CategoryDot({ category, className }: { category: ColumnCategory; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", CATEGORY_CLASS[category], className)} />;
}

/** A badge naming a column with its category colour. */
export function CategoryBadge({ category, name }: { category: ColumnCategory; name: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <CategoryDot category={category} />
      {name}
    </Badge>
  );
}

/** A badge showing a priority; MVP is emphasised. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={priority === "MVP" ? "default" : "secondary"}>{priority}</Badge>;
}

/** A badge showing an owner, or "Unowned". */
export function OwnerBadge({ name }: { name: string | null }) {
  return <Badge variant="outline">{name ?? "Unowned"}</Badge>;
}

/** Category colour used for each task state. */
const STATE_CATEGORY: Record<TaskState, ColumnCategory> = { todo: "todo", doing: "active", blocked: "blocked", done: "done" };

/** A badge showing a task state with its colour. */
export function TaskStateBadge({ state }: { state: TaskState }) {
  return <CategoryBadge category={STATE_CATEGORY[state]} name={state} />;
}
```

`src/components/page-header.tsx`:

```tsx
/** Page title block: a small eyebrow, the title, an optional description and actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-balance">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
```

`src/components/update-list.tsx`:

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { UpdateItem } from "@/lib/ops/updates";
import { relativeAge } from "@/lib/time";
import { Markdown } from "./markdown";

/** A progress update with its timestamp as an ISO string. */
export type UpdateView = Omit<UpdateItem, "createdAt"> & { createdAt: string };

/**
 * Renders progress updates as a timeline, newest first.
 *
 * @param props.showSystem whether each entry links to its system (project feed)
 */
export function UpdateList({ updates, showSystem = false, projectSlug }: { updates: UpdateView[]; showSystem?: boolean; projectSlug: string }) {
  if (updates.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No progress updates yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {updates.map((u) => (
        <li key={u.id}>
          <Card size="sm">
            <CardContent className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{u.author}</span>
                {u.isAgent && <Badge variant="secondary">agent</Badge>}
                {showSystem && (
                  <Link href={`/p/${projectSlug}/systems/${u.systemSlug}`} className="text-primary hover:underline">
                    {u.systemTitle}
                  </Link>
                )}
                <time className="ml-auto font-mono text-xs text-muted-foreground" dateTime={u.createdAt} title={u.createdAt}>
                  {relativeAge(u.createdAt)}
                </time>
              </div>
              <Markdown className="text-sm">{u.summary}</Markdown>
              {u.nextStep && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">Next:</span> {u.nextStep}
                </p>
              )}
              {(u.taskTitle || u.commitHash) && (
                <div className="flex flex-wrap gap-2">
                  {u.taskTitle && <Badge variant="outline">Task: {u.taskTitle}</Badge>}
                  {u.commitHash &&
                    (u.commitUrl ? (
                      <Badge variant="outline" asChild>
                        <a href={u.commitUrl} target="_blank" rel="noreferrer noopener" className="font-mono">
                          {u.commitHash.slice(0, 7)}
                        </a>
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-mono">
                        {u.commitHash.slice(0, 7)}
                      </Badge>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}
```

If `Card` has no `size` prop in the generated component, drop `size="sm"`.

`src/components/history-list.tsx`:

```tsx
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { HistoryEntry } from "@/lib/ops/activity";

/** A change log entry with its timestamp as an ISO string. */
export type HistoryView = Omit<HistoryEntry, "createdAt"> & { createdAt: string };

/** Shortens long values such as notes for one-line display. */
function short(value: string | null): string {
  if (value == null || value === "") return "—";
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

/** Renders change log entries, newest first. */
export function HistoryList({ entries, showEntity = false }: { entries: HistoryView[]; showEntity?: boolean }) {
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No changes yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap gap-x-2">
          <time className="font-mono text-xs text-muted-foreground" dateTime={e.createdAt}>
            {e.createdAt.slice(0, 16).replace("T", " ")}
          </time>
          <span className="font-medium">{e.author}</span>
          <span className="text-muted-foreground">
            {showEntity && <span className="font-mono text-xs">{e.entity} </span>}
            {e.field}: {short(e.oldValue)} → {short(e.newValue)}
          </span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/components/markdown.test.tsx && npm run typecheck
git add -A
git commit -m "feat: Add shared UI pieces: safe markdown, chips, update and history lists"
```

Expected: 3 passed.

---

### Task 6.2: Server actions, home page and project shell

**Files:**
- Create: `src/app/(app)/actions.ts`, `src/app/(app)/p/[project]/actions.ts`, `src/components/new-project-dialog.tsx`, `src/components/project-nav.tsx`, `src/app/(app)/p/[project]/layout.tsx`
- Modify: `src/app/(app)/page.tsx` (replace), `src/app/(app)/layout.tsx` (projects in nav)

**Interfaces:**
- Produces server actions (all return `ActionResult`, value `undefined` unless noted):
  - `createProjectAction(input: z.input<typeof createProjectInput>): ActionResult<{ slug: string }>`
  - in `p/[project]/actions.ts`: `updateProjectAction(project, patch)`, `deleteProjectAction(project)`, `setMemberAction(project, input)`, `removeMemberAction(project, userId)`, `createBoardAction(project, input): ActionResult<{ slug: string }>`, `setBoardColumnsAction(project, board, columns)`, `createDomainAction(project, input)`, `deleteDomainAction(project, id)`, `createPhaseAction(project, input)`, `deletePhaseAction(project, id)`, `createSystemAction(project, input): ActionResult<{ slug: string }>`, `updateSystemAction(project, system, patch)`, `moveSystemAction(project, system, input)`, `addTaskAction(project, system, input)`, `updateTaskAction(taskId, patch)`, `deleteTaskAction(taskId)`, `addQuestionAction(project, input)`, `answerQuestionAction(project, input)`, `setQuestionResolvedAction(project, id, resolved)`, `acceptAdrAction(project, number)`, `reopenPlanningAction(project, system)`
  - `<ProjectNav project={{ slug, name }} projects={{ slug, name }[]} />`

- [ ] **Step 1: Write the server actions**

`src/app/(app)/actions.ts`:

```ts
"use server";

import type { z } from "zod";
import { runAction } from "@/app/actions/run";
import { createProject, type createProjectInput } from "@/lib/ops/projects";

/** Creates a project owned by the signed-in user and returns its slug. */
export async function createProjectAction(input: z.input<typeof createProjectInput>) {
  return runAction(async (db, actor) => ({ slug: (await createProject(db, actor, input)).slug }));
}
```

`src/app/(app)/p/[project]/actions.ts`:

```ts
"use server";

import type { z } from "zod";
import { runAction } from "@/app/actions/run";
import { acceptAdr } from "@/lib/ops/adrs";
import { createBoard, setBoardColumns, type createBoardInput, type setColumnsInput } from "@/lib/ops/boards";
import { removeMember, setMember, type setMemberInput } from "@/lib/ops/members";
import { reopenPlanning } from "@/lib/ops/planning";
import { deleteProject, updateProject, type updateProjectInput } from "@/lib/ops/projects";
import {
  addQuestion,
  answerQuestion,
  setQuestionResolved,
  type addQuestionInput,
  type answerQuestionInput,
} from "@/lib/ops/questions";
import { createDomain, createPhase, deleteDomain, deletePhase, type domainInput, type phaseInput } from "@/lib/ops/structure";
import {
  createSystem,
  moveSystem,
  updateSystem,
  type createSystemInput,
  type moveSystemInput,
  type updateSystemInput,
} from "@/lib/ops/systems";
import { addTask, deleteTask, updateTask, type addTaskInput, type updateTaskInput } from "@/lib/ops/tasks";

/** Changes the project's name, description or repository URL. */
export async function updateProjectAction(project: string, patch: z.input<typeof updateProjectInput>) {
  return runAction(async (db, actor) => void (await updateProject(db, actor, project, patch)));
}

/** Deletes the project and everything in it. */
export async function deleteProjectAction(project: string) {
  return runAction((db, actor) => deleteProject(db, actor, project));
}

/** Adds a member or changes their role. */
export async function setMemberAction(project: string, input: z.input<typeof setMemberInput>) {
  return runAction((db, actor) => setMember(db, actor, project, input));
}

/** Removes a member. */
export async function removeMemberAction(project: string, userId: string) {
  return runAction((db, actor) => removeMember(db, actor, project, userId));
}

/** Adds a board and returns its slug. */
export async function createBoardAction(project: string, input: z.input<typeof createBoardInput>) {
  return runAction(async (db, actor) => ({ slug: (await createBoard(db, actor, project, input)).slug }));
}

/** Replaces a board's columns. */
export async function setBoardColumnsAction(project: string, board: string, input: z.input<typeof setColumnsInput>) {
  return runAction(async (db, actor) => void (await setBoardColumns(db, actor, project, board, input)));
}

/** Adds a domain. */
export async function createDomainAction(project: string, input: z.input<typeof domainInput>) {
  return runAction(async (db, actor) => void (await createDomain(db, actor, project, input)));
}

/** Deletes a domain. */
export async function deleteDomainAction(project: string, id: string) {
  return runAction((db, actor) => deleteDomain(db, actor, project, id));
}

/** Adds a phase. */
export async function createPhaseAction(project: string, input: z.input<typeof phaseInput>) {
  return runAction(async (db, actor) => void (await createPhase(db, actor, project, input)));
}

/** Deletes a phase. */
export async function deletePhaseAction(project: string, id: string) {
  return runAction((db, actor) => deletePhase(db, actor, project, id));
}

/** Creates a system in planning and returns its slug. */
export async function createSystemAction(project: string, input: z.input<typeof createSystemInput>) {
  return runAction(async (db, actor) => ({ slug: (await createSystem(db, actor, project, input)).slug }));
}

/** Changes a system's fields. */
export async function updateSystemAction(project: string, system: string, patch: z.input<typeof updateSystemInput>) {
  return runAction(async (db, actor) => void (await updateSystem(db, actor, project, system, patch)));
}

/** Moves a system to a column; the planning gate applies. */
export async function moveSystemAction(project: string, system: string, input: z.input<typeof moveSystemInput>) {
  return runAction(async (db, actor) => void (await moveSystem(db, actor, project, system, input)));
}

/** Adds a task to a system. */
export async function addTaskAction(project: string, system: string, input: z.input<typeof addTaskInput>) {
  return runAction(async (db, actor) => void (await addTask(db, actor, project, system, input)));
}

/** Changes a task. */
export async function updateTaskAction(taskId: number, patch: z.input<typeof updateTaskInput>) {
  return runAction((db, actor) => updateTask(db, actor, taskId, patch));
}

/** Deletes a task. */
export async function deleteTaskAction(taskId: number) {
  return runAction((db, actor) => deleteTask(db, actor, taskId));
}

/** Adds an open question. */
export async function addQuestionAction(project: string, input: z.input<typeof addQuestionInput>) {
  return runAction(async (db, actor) => void (await addQuestion(db, actor, project, input)));
}

/** Answers a question. */
export async function answerQuestionAction(project: string, input: z.input<typeof answerQuestionInput>) {
  return runAction((db, actor) => answerQuestion(db, actor, project, input));
}

/** Marks a question resolved or unresolved. */
export async function setQuestionResolvedAction(project: string, id: string, resolved: boolean) {
  return runAction((db, actor) => setQuestionResolved(db, actor, project, id, resolved));
}

/** Accepts a proposed ADR. */
export async function acceptAdrAction(project: string, number: number) {
  return runAction((db, actor) => acceptAdr(db, actor, project, number));
}

/** Reopens a system's planning. */
export async function reopenPlanningAction(project: string, system: string) {
  return runAction((db, actor) => reopenPlanning(db, actor, project, system));
}
```

- [ ] **Step 2: Write the project list and the new-project dialog**

`src/components/new-project-dialog.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createProjectAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Turns a name into a slug suggestion: lowercase words joined by dashes. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Button and dialog creating a project; opens the new project on success. */
export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createProjectAction({ name, slug, description, repoUrl: repoUrl.trim() || null });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              router.push(`/p/${result.value.slug}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You become its owner. It starts with a Development board.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
              <Input
                id="project-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <FieldDescription>Used in URLs, surf-roadmap.json and by agents. Lowercase letters, digits and dashes.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">Description</FieldLabel>
              <Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-repo">Repository URL</FieldLabel>
              <Input id="project-repo" placeholder="https://github.com/org/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
              <FieldDescription>Commit hashes in progress updates link here.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/(app)/page.tsx` (replace):

```tsx
import Link from "next/link";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listProjects } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** Start page: the projects the user belongs to, and project creation. */
export default async function HomePage() {
  const projects = await pageData((db, actor) => listProjects(db, actor));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Projects" title="Your projects" actions={<NewProjectDialog />} />
      {projects.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>Create one, or ask a project owner to add you.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProjectDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.slug}`} className="block h-full">
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {p.name}
                      <Badge variant="secondary">{p.role}</Badge>
                    </CardTitle>
                    <CardDescription>{p.description || p.slug}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the project navigation and layout**

`src/components/project-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Sections of a project, in navigation order. */
const SECTIONS = [
  { path: "", label: "Catalogue" },
  { path: "/boards", label: "Boards" },
  { path: "/roadmap", label: "Roadmap" },
  { path: "/adrs", label: "ADRs" },
  { path: "/questions", label: "Questions" },
  { path: "/updates", label: "Updates" },
  { path: "/members", label: "Members" },
  { path: "/activity", label: "Activity" },
  { path: "/settings", label: "Settings" },
];

/** Project switcher and section links; the current section is highlighted. */
export function ProjectNav({ project, projects }: { project: { slug: string; name: string }; projects: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const base = `/p/${project.slug}`;
  const current = SECTIONS.slice()
    .reverse()
    .find((s) => (s.path === "" ? pathname === base || pathname.startsWith(`${base}/systems`) : pathname.startsWith(base + s.path)));

  return (
    <div className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="font-semibold">
              {project.name}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Switch project</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem key={p.slug} asChild>
                <Link href={`/p/${p.slug}`}>{p.name}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/">All projects</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <nav className="flex flex-wrap gap-1 text-sm">
          {SECTIONS.map((s) => (
            <Button key={s.label} variant="ghost" size="sm" asChild className={cn(current === s && "bg-muted")}>
              <Link href={base + s.path} aria-current={current === s ? "page" : undefined}>
                {s.label}
              </Link>
            </Button>
          ))}
        </nav>
      </div>
    </div>
  );
}
```

`src/app/(app)/p/[project]/layout.tsx`:

```tsx
import { ProjectNav } from "@/components/project-nav";
import { getProject, listProjects } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/**
 * Shell of every project page: loads the project (404 when invisible) and shows the project navigation.
 *
 * @param props.params the route parameters with the project slug
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { detail, projects } = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    projects: await listProjects(db, actor),
  }));
  return (
    <>
      <ProjectNav project={{ slug, name: detail.project.name }} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))} />
      <div className="mx-auto max-w-7xl py-6">{children}</div>
    </>
  );
}
```

The `(app)` layout wraps children in `<main className="mx-auto max-w-7xl px-4 py-6">`; project pages need the project nav full-width above that. Change `src/app/(app)/layout.tsx` so `main` has no padding or max width and each page decides:

```tsx
import { Nav } from "@/components/nav";
import { requireActor } from "@/lib/auth/actor";

/** Every signed-in page reads live data. */
export const dynamic = "force-dynamic";

/**
 * Shell for every signed-in page: checks the session, then renders the navigation.
 *
 * @param props.children the page content
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <>
      <Nav actor={actor} />
      <main className="px-4">{children}</main>
    </>
  );
}
```

and give the non-project pages (`/`, `/admin/users`, `/settings/api-keys`) an outer `<div className="mx-auto max-w-7xl py-6">` around their current root element.

- [ ] **Step 4: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add project list, project creation and project navigation"
```

Expected: the build lists `/p/[project]` routes once Task 6.3 adds its first page; until then it only lists the layout-free routes, which is fine.

---

### Task 6.3: Catalogue, new-system dialog and roadmap

**Files:**
- Create: `src/app/(app)/p/[project]/page.tsx`, `src/components/new-system-dialog.tsx`, `src/components/system-card.tsx`, `src/app/(app)/p/[project]/roadmap/page.tsx`, `src/lib/progress.ts`
- Test: `src/lib/progress.test.ts`

**Interfaces:**
- Produces: `categoryProgress(items: { columnCategory: ColumnCategory }[]): number` (done share, 0–100); `<SystemCard system latest projectSlug />`; `<NewSystemDialog projectSlug boards />`.

- [ ] **Step 1: Write the failing test**

`src/lib/progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryProgress } from "./progress";

describe("categoryProgress", () => {
  it("returns the rounded share of systems in done columns", () => {
    expect(categoryProgress([])).toBe(0);
    expect(categoryProgress([{ columnCategory: "done" }, { columnCategory: "active" }, { columnCategory: "planning" }])).toBe(33);
    expect(categoryProgress([{ columnCategory: "done" }])).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run src/lib/progress.test.ts` → FAIL, module not found.

`src/lib/progress.ts`:

```ts
import type { ColumnCategory } from "@/db/schema";

/** Returns the share of items in a done column as a whole percentage (0 when empty). */
export function categoryProgress(items: { columnCategory: ColumnCategory }[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter((i) => i.columnCategory === "done").length / items.length) * 100);
}
```

Run again → PASS.

- [ ] **Step 3: Write the system card and the new-system dialog**

`src/components/system-card.tsx`:

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemListItem } from "@/lib/ops/systems";
import { relativeAge } from "@/lib/time";
import { CategoryBadge, OwnerBadge, PriorityBadge } from "./chips";

/** A catalogue card for one system with its column, priority, owner, tasks and latest update. */
export function SystemCard({
  system,
  latest,
  projectSlug,
}: {
  system: SystemListItem;
  latest?: { summary: string; createdAt: string };
  projectSlug: string;
}) {
  return (
    <Link href={`/p/${projectSlug}/systems/${system.slug}`} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2">
            {system.title}
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{system.boardName}</span>
          </CardTitle>
          {system.summary && <CardDescription className="line-clamp-3">{system.summary}</CardDescription>}
        </CardHeader>
        <CardContent className="mt-auto flex flex-col gap-2">
          {latest && (
            <p className="line-clamp-2 border-l-2 border-primary pl-2 text-xs text-muted-foreground">
              {relativeAge(latest.createdAt)}: {latest.summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={system.columnCategory} name={system.columnName} />
            <PriorityBadge priority={system.priority} />
            <OwnerBadge name={system.ownerName} />
            {!system.planningComplete && <Badge variant="outline">planning open</Badge>}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {system.tasksDone}/{system.tasksTotal} tasks
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

`src/components/new-system-dialog.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createSystemAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/** Button and dialog creating a system in a board's planning column. */
export function NewSystemDialog({ projectSlug, boards }: { projectSlug: string; boards: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [board, setBoard] = useState(boards[0]?.slug ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New system</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createSystemAction(projectSlug, { title, slug, summary, board });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              router.push(`/p/${projectSlug}/systems/${result.value.slug}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New system</DialogTitle>
            <DialogDescription>
              It starts in planning. Plan it with <code>/surf-roadmap:plan</code> before any work starts.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="system-title">Title</FieldLabel>
              <Input
                id="system-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="system-slug">Slug</FieldLabel>
              <Input id="system-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <FieldDescription>Agents refer to the system by this.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="system-board">Board</FieldLabel>
              <NativeSelect id="system-board" value={board} onChange={(e) => setBoard(e.target.value)}>
                {boards.map((b) => (
                  <NativeSelectOption key={b.slug} value={b.slug}>
                    {b.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="system-summary">Summary</FieldLabel>
              <Textarea id="system-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim() || !slug.trim()}>
              Create system
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the catalogue page**

`src/app/(app)/p/[project]/page.tsx`:

```tsx
import Link from "next/link";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { PageHeader } from "@/components/page-header";
import { SystemCard } from "@/components/system-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COLUMN_CATEGORIES, PRIORITIES } from "@/db/schema";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { listSystems, systemFilter } from "@/lib/ops/systems";
import { latestUpdates } from "@/lib/ops/updates";
import { pageData } from "@/lib/page";

/** Reads one string search parameter, or an empty string. */
function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Catalogue of a project's systems grouped by domain, filterable by board, phase,
 * column category, priority and owner.
 */
export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const raw = { board: param(sp.board), phase: param(sp.phase), category: param(sp.category), priority: param(sp.priority), owner: param(sp.owner) };
  const filter = systemFilter.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const data = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    return {
      detail,
      systems: await listSystems(db, actor, slug, filter.success ? filter.data : {}),
      domains: await listDomains(db, actor, slug),
      phases: await listPhases(db, actor, slug),
      members: await listMembers(db, actor, slug),
      latest: await latestUpdates(db, detail.project.id),
    };
  });
  const canEdit = data.detail.role !== "viewer";
  const groups = [
    ...data.domains.map((d) => ({ key: d.id, name: d.name, description: d.description, items: data.systems.filter((s) => s.domainId === d.id) })),
    { key: "none", name: "No domain", description: "", items: data.systems.filter((s) => !s.domainId) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Catalogue"
        title={data.detail.project.name}
        description={data.detail.project.description}
        actions={canEdit && <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />}
      />
      <form className="flex flex-wrap items-end gap-2" method="get">
        <NativeSelect name="board" defaultValue={raw.board} aria-label="Board">
          <NativeSelectOption value="">All boards</NativeSelectOption>
          {data.detail.boards.map((b) => (
            <NativeSelectOption key={b.id} value={b.slug}>
              {b.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="phase" defaultValue={raw.phase} aria-label="Phase">
          <NativeSelectOption value="">All phases</NativeSelectOption>
          {data.phases.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={raw.category} aria-label="Column category">
          <NativeSelectOption value="">Any column</NativeSelectOption>
          {COLUMN_CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="priority" defaultValue={raw.priority} aria-label="Priority">
          <NativeSelectOption value="">Any priority</NativeSelectOption>
          {PRIORITIES.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {p}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="owner" defaultValue={raw.owner} aria-label="Owner">
          <NativeSelectOption value="">Any owner</NativeSelectOption>
          <NativeSelectOption value="none">Unowned</NativeSelectOption>
          {data.members.map((m) => (
            <NativeSelectOption key={m.userId} value={m.userId}>
              {m.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/p/${slug}`}>Reset</Link>
        </Button>
      </form>
      {groups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No systems</EmptyTitle>
            <EmptyDescription>{data.systems.length === 0 && !filter.success ? "" : "Nothing matches these filters, or the project has no systems yet."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">{g.name}</h2>
              <span className="text-sm text-muted-foreground">{g.description}</span>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((s) => {
                const latest = data.latest.get(s.id);
                return (
                  <li key={s.id}>
                    <SystemCard
                      system={s}
                      projectSlug={slug}
                      latest={latest && { summary: latest.summary, createdAt: latest.createdAt.toISOString() }}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the roadmap page**

`src/app/(app)/p/[project]/roadmap/page.tsx`:

```tsx
import Link from "next/link";
import { CategoryBadge } from "@/components/chips";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { listPhases } from "@/lib/ops/structure";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";
import { categoryProgress } from "@/lib/progress";

/** Phase roadmap: each phase with its goal, dependencies, progress and systems. */
export default async function RoadmapPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { phases, systems } = await pageData(async (db, actor) => ({
    phases: await listPhases(db, actor, slug),
    systems: await listSystems(db, actor, slug),
  }));
  const name = new Map(phases.map((p) => [p.id, p.name]));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Roadmap" title="Delivery phases" />
      {phases.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No phases yet</EmptyTitle>
            <EmptyDescription>Add phases in Settings, or let an agent create them with create_phase.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ol className="flex flex-col gap-3">
        {phases.map((p) => {
          const items = systems.filter((s) => s.phaseId === p.id);
          const progress = categoryProgress(items);
          return (
            <li key={p.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                    {p.name}
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {items.filter((s) => s.columnCategory === "done").length}/{items.length} done · {progress}%
                    </span>
                  </CardTitle>
                  {p.goal && <CardDescription>{p.goal}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Progress value={progress} aria-label={`${p.name} progress`} />
                  {p.dependsOn.length > 0 && (
                    <p className="text-xs text-muted-foreground">Builds on: {p.dependsOn.map((d) => name.get(d) ?? d).join(", ")}</p>
                  )}
                  <ul className="flex flex-wrap gap-2">
                    {items.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/p/${slug}/systems/${s.slug}`}
                          className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm hover:border-primary"
                        >
                          {s.title}
                          <CategoryBadge category={s.columnCategory} name={s.columnName} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add project catalogue, system creation and roadmap pages"
```

---

### Task 6.4: Boards: kanban, board tabs, new board and column editor

**Files:**
- Create: `src/app/(app)/p/[project]/boards/page.tsx`, `src/app/(app)/p/[project]/boards/[board]/page.tsx`, `src/components/board-view.tsx`, `src/components/new-board-dialog.tsx`, `src/components/column-editor.tsx`

**Interfaces:**
- Produces: `<BoardView projectSlug columns cards canEdit />` where `cards: { slug; title; priority; ownerName; columnId; planningComplete }[]`; `<NewBoardDialog projectSlug />`; `<ColumnEditor projectSlug boardSlug columns />`.

- [ ] **Step 1: Write the board components**

`src/components/board-view.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction } from "@/app/(app)/p/[project]/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ColumnCategory, Priority } from "@/db/schema";
import { cn } from "@/lib/utils";
import { CategoryDot, OwnerBadge, PriorityBadge } from "./chips";

/** A column of the board. */
export interface BoardColumnView {
  id: string;
  name: string;
  category: ColumnCategory;
}

/** A system card on the board. */
export interface BoardCardView {
  slug: string;
  title: string;
  priority: Priority;
  ownerName: string | null;
  columnId: string;
  planningComplete: boolean;
}

/**
 * Kanban board over custom columns. Dragging a card onto a column, or choosing a
 * column in the card's menu, moves the system; the server enforces the planning gate.
 */
export function BoardView({
  projectSlug,
  columns,
  cards,
  canEdit,
}: {
  projectSlug: string;
  columns: BoardColumnView[];
  cards: BoardCardView[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [optimistic, moveOptimistic] = useOptimistic(cards, (state, move: { slug: string; columnId: string }) =>
    state.map((c) => (c.slug === move.slug ? { ...c, columnId: move.columnId } : c)),
  );

  /** Moves a card to a column and persists it; a refusal restores the card and shows why. */
  const move = (slug: string, columnId: string) => {
    const card = optimistic.find((c) => c.slug === slug);
    if (!card || card.columnId === columnId || !canEdit) return;
    startTransition(async () => {
      moveOptimistic({ slug, columnId });
      const result = await moveSystemAction(projectSlug, slug, { column: columnId });
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="overflow-x-auto pb-2" aria-busy={pending}>
      <div className="grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3">
        {columns.map((col) => {
          const items = optimistic.filter((c) => c.columnId === col.id);
          return (
            <section
              key={col.id}
              aria-label={col.name}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                move(e.dataTransfer.getData("text/plain"), col.id);
              }}
              className={cn("flex min-h-48 flex-col gap-2 rounded-lg border bg-muted/40 p-2", dragOver === col.id && "border-primary")}
            >
              <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
                <CategoryDot category={col.category} />
                {col.name}
                <span className="ml-auto text-muted-foreground tabular-nums">{items.length}</span>
              </h2>
              {items.map((c) => (
                <Card
                  key={c.slug}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.slug)}
                  className={cn(canEdit && "cursor-grab active:cursor-grabbing")}
                >
                  <CardContent className="flex flex-col gap-2">
                    <Link href={`/p/${projectSlug}/systems/${c.slug}`} className="text-sm font-medium hover:underline">
                      {c.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PriorityBadge priority={c.priority} />
                      <OwnerBadge name={c.ownerName} />
                      {!c.planningComplete && <Badge variant="outline">planning open</Badge>}
                    </div>
                    {canEdit && (
                      <NativeSelect
                        size="sm"
                        aria-label={`Move ${c.title}`}
                        value={c.columnId}
                        disabled={pending}
                        onChange={(e) => move(c.slug, e.target.value)}
                      >
                        {columns.map((o) => (
                          <NativeSelectOption key={o.id} value={o.id}>
                            {o.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

`src/components/new-board-dialog.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createBoardAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Button and dialog adding a board with the default columns; opens it on success. */
export function NewBoardDialog({ projectSlug }: { projectSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">New board</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createBoardAction(projectSlug, { name, slug });
              if (!result.ok) return void toast.error(result.error);
              setOpen(false);
              router.push(`/p/${projectSlug}/boards/${result.value.slug}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>A workstream such as Building. It starts with the default columns, which you can change.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="board-name">Name</FieldLabel>
              <Input
                id="board-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-slug">Slug</FieldLabel>
              <Input id="board-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
              Create board
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/column-editor.tsx`:

```tsx
"use client";

import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setBoardColumnsAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COLUMN_CATEGORIES, type ColumnCategory } from "@/db/schema";
import { CategoryDot } from "./chips";

/** A column being edited; `id` is absent for new columns. */
interface DraftColumn {
  key: string;
  id?: string;
  name: string;
  category: ColumnCategory;
}

/**
 * Dialog editing a board's columns: rename, recategorise, reorder, add and remove.
 * The server checks the rules (one planning column, at least one done column,
 * no deleting columns that hold systems).
 */
export function ColumnEditor({
  projectSlug,
  boardSlug,
  columns,
}: {
  projectSlug: string;
  boardSlug: string;
  columns: { id: string; name: string; category: ColumnCategory }[];
}) {
  const initial = () => columns.map((c) => ({ key: c.id, id: c.id, name: c.name, category: c.category }));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftColumn[]>(initial);
  const [pending, startTransition] = useTransition();

  /** Replaces the column at `index` with `patch` applied. */
  const change = (index: number, patch: Partial<DraftColumn>) => setDraft((d) => d.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  /** Moves the column at `index` by `delta` positions. */
  const shift = (index: number, delta: number) =>
    setDraft((d) => {
      const next = [...d];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(initial());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit columns</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            The category gives a column its meaning. Exactly one column is the planning column, and at least one is done.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-2">
          {draft.map((c, i) => (
            <li key={c.key} className="flex items-center gap-2">
              <CategoryDot category={c.category} />
              <Input aria-label={`Name of column ${i + 1}`} value={c.name} onChange={(e) => change(i, { name: e.target.value })} className="flex-1" />
              <NativeSelect aria-label={`Category of ${c.name}`} value={c.category} onChange={(e) => change(i, { category: e.target.value as ColumnCategory })}>
                {COLUMN_CATEGORIES.map((cat) => (
                  <NativeSelectOption key={cat} value={cat}>
                    {cat}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.name} up`} onClick={() => shift(i, -1)} disabled={i === 0}>
                <ArrowUpIcon />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.name} down`} onClick={() => shift(i, 1)} disabled={i === draft.length - 1}>
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setDraft((d) => [...d, { key: crypto.randomUUID(), name: "New column", category: "todo" }])}
        >
          Add column
        </Button>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setBoardColumnsAction(projectSlug, boardSlug, {
                  columns: draft.map(({ id, name, category }) => ({ id, name, category })),
                });
                if (!result.ok) return void toast.error(result.error);
                toast.success("Columns saved");
                setOpen(false);
              })
            }
          >
            Save columns
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the board pages**

`src/app/(app)/p/[project]/boards/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** Opens the first board of the project. */
export default async function BoardsIndex({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const detail = await pageData((db, actor) => getProject(db, actor, slug));
  const first = detail.boards[0];
  if (!first) notFound();
  redirect(`/p/${slug}/boards/${first.slug}`);
}
```

`src/app/(app)/p/[project]/boards/[board]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board-view";
import { ColumnEditor } from "@/components/column-editor";
import { NewBoardDialog } from "@/components/new-board-dialog";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getProject } from "@/lib/ops/projects";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";

/** One board of the project as a kanban, with tabs for the other boards. */
export default async function BoardPage({ params }: { params: Promise<{ project: string; board: string }> }) {
  const { project: slug, board: boardSlug } = await params;
  const { detail, systems } = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    systems: await listSystems(db, actor, slug, { board: boardSlug }),
  }));
  const board = detail.boards.find((b) => b.slug === boardSlug);
  if (!board) notFound();
  const canEdit = detail.role !== "viewer";
  const canOwn = detail.role === "owner" || detail.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Boards"
        title={board.name}
        description="Drag a card to another column, or use its menu. Systems leave planning only after their planning interview is complete."
        actions={
          canOwn && (
            <>
              <ColumnEditor projectSlug={slug} boardSlug={board.slug} columns={board.columns} />
              <NewBoardDialog projectSlug={slug} />
            </>
          )
        }
      />
      <Tabs value={board.slug}>
        <TabsList>
          {detail.boards.map((b) => (
            <TabsTrigger key={b.id} value={b.slug} asChild>
              <Link href={`/p/${slug}/boards/${b.slug}`}>{b.name}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <BoardView
        projectSlug={slug}
        canEdit={canEdit}
        columns={board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
        cards={systems.map((s) => ({
          slug: s.slug,
          title: s.title,
          priority: s.priority,
          ownerName: s.ownerName,
          columnId: s.columnId,
          planningComplete: s.planningComplete,
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add boards with kanban, board tabs and a column editor"
```

---

### Task 6.5: System page with task list above the Planning, Agent updates and History accordions

**Files:**
- Create: `src/app/(app)/p/[project]/systems/[system]/page.tsx`, `src/components/task-list.tsx`, `src/components/system-editor.tsx`, `src/components/document-section.tsx`, `src/components/version-picker.tsx`, `src/components/planning-rounds.tsx`

**Interfaces:**
- Produces: `<TaskList projectSlug systemSlug tasks members canEdit planningComplete />`; `<SystemEditor projectSlug systemSlug board columns planningComplete priority ownerUserId notes members canEdit />`; `<DocumentSection title kind doc param />`; `<VersionPicker param versions current />`; `<PlanningRounds rounds confirmation />`.

Order on the page (spec 7): header → spec → plan → open questions → **task list** → accordions **Planning**, **Agent updates**, **History** (all closed by default, entry count in each trigger). Sidebar: editor and planning status.

- [ ] **Step 1: Write the version picker and document section**

`src/components/version-picker.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Chooses which version of a document to show by setting the `param` search parameter. */
export function VersionPicker({ param, versions, current }: { param: string; versions: number[]; current: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <NativeSelect
      size="sm"
      aria-label="Version"
      value={String(current)}
      onChange={(e) => {
        const next = new URLSearchParams(search);
        if (Number(e.target.value) === versions[0]) next.delete(param);
        else next.set(param, e.target.value);
        router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
      }}
    >
      {versions.map((v, i) => (
        <NativeSelectOption key={v} value={String(v)}>
          v{v}
          {i === 0 ? " (latest)" : ""}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
```

`src/components/document-section.tsx`:

```tsx
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocumentView } from "@/lib/ops/documents";
import { Markdown } from "./markdown";
import { VersionPicker } from "./version-picker";

/** A spec or plan card: the chosen version rendered, with its author and a version picker. */
export function DocumentSection({ title, doc, param, empty }: { title: string; doc: DocumentView | null; param: string; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {doc && (
          <CardDescription>
            v{doc.version} by {doc.author}, {doc.createdAt.toISOString().slice(0, 10)}
          </CardDescription>
        )}
        {doc && doc.versions.length > 1 && (
          <CardAction>
            <VersionPicker param={param} versions={doc.versions} current={doc.version} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{doc ? <Markdown>{doc.body}</Markdown> : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Write the task list**

`src/components/task-list.tsx`:

```tsx
"use client";

import { TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addTaskAction, deleteTaskAction, updateTaskAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TASK_STATES, type TaskState } from "@/db/schema";
import type { TaskItem } from "@/lib/ops/systems";
import { cn } from "@/lib/utils";
import { TaskStateBadge } from "./chips";

/**
 * The system's tasks with state and owner menus, deletion and an add form. While
 * planning is open, the doing and done states are disabled.
 */
export function TaskList({
  projectSlug,
  systemSlug,
  tasks,
  members,
  canEdit,
  planningComplete,
}: {
  projectSlug: string;
  systemSlug: string;
  tasks: TaskItem[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
  planningComplete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
    });

  const done = tasks.filter((t) => t.state === "done").length;
  const locked = (s: TaskState) => !planningComplete && (s === "doing" || s === "done");

  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardDescription>{planningComplete ? "Starting a task makes you its owner." : "Tasks can start once planning is complete."}</CardDescription>
        <CardAction className="text-sm text-muted-foreground tabular-nums">
          {done}/{tasks.length} done
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="divide-y rounded-md border">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {t.planStep !== null && <span className="font-mono text-xs text-muted-foreground">#{t.planStep}</span>}
              <span className={cn("min-w-40 flex-1", t.state === "done" && "text-muted-foreground line-through")}>{t.title}</span>
              {canEdit ? (
                <>
                  <NativeSelect
                    size="sm"
                    aria-label={`State of ${t.title}`}
                    value={t.state}
                    disabled={pending}
                    onChange={(e) => act(() => updateTaskAction(t.id, { state: e.target.value as TaskState }))}
                  >
                    {TASK_STATES.map((s) => (
                      <NativeSelectOption key={s} value={s} disabled={locked(s)}>
                        {s}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    size="sm"
                    aria-label={`Owner of ${t.title}`}
                    value={t.ownerUserId ?? ""}
                    disabled={pending}
                    onChange={(e) => act(() => updateTaskAction(t.id, { ownerUserId: e.target.value || null }))}
                  >
                    <NativeSelectOption value="">Unowned</NativeSelectOption>
                    {members.map((m) => (
                      <NativeSelectOption key={m.userId} value={m.userId}>
                        {m.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${t.title}`}>
                        <TrashIcon />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                        <AlertDialogDescription>{t.title}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => act(() => deleteTaskAction(t.id))}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <>
                  <TaskStateBadge state={t.state} />
                  <span className="text-sm text-muted-foreground">{t.ownerName ?? "Unowned"}</span>
                </>
              )}
            </li>
          ))}
          {tasks.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No tasks yet.</li>}
        </ul>
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = title;
              setTitle("");
              act(() => addTaskAction(projectSlug, systemSlug, { title: value }));
            }}
          >
            <Input aria-label="New task" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" variant="outline" disabled={pending || !title.trim()}>
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Write the system editor and the planning rounds**

`src/components/system-editor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moveSystemAction, reopenPlanningAction, updateSystemAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, type ColumnCategory, type Priority } from "@/db/schema";

/** Sidebar editor for a system's column, priority, owner and notes, plus reopening planning. */
export function SystemEditor({
  projectSlug,
  systemSlug,
  columnId,
  columns,
  planningComplete,
  priority,
  ownerUserId,
  notes,
  members,
  canEdit,
}: {
  projectSlug: string;
  systemSlug: string;
  columnId: string;
  columns: { id: string; name: string; category: ColumnCategory }[];
  planningComplete: boolean;
  priority: Priority;
  ownerUserId: string | null;
  notes: string;
  members: { userId: string; name: string }[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(notes);

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
    });

  return (
    <Card aria-busy={pending}>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="system-column">Column</FieldLabel>
            <NativeSelect
              id="system-column"
              value={columnId}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => moveSystemAction(projectSlug, systemSlug, { column: e.target.value }))}
            >
              {columns.map((c) => (
                <NativeSelectOption key={c.id} value={c.id} disabled={!planningComplete && c.category !== "planning"}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {!planningComplete && <FieldDescription>Other columns unlock when the planning interview is complete.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="system-priority">Priority</FieldLabel>
            <NativeSelect
              id="system-priority"
              value={priority}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => updateSystemAction(projectSlug, systemSlug, { priority: e.target.value as Priority }))}
            >
              {PRIORITIES.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="system-owner">Owner</FieldLabel>
            <NativeSelect
              id="system-owner"
              value={ownerUserId ?? ""}
              disabled={!canEdit || pending}
              onChange={(e) => act(() => updateSystemAction(projectSlug, systemSlug, { ownerUserId: e.target.value || null }))}
            >
              <NativeSelectOption value="">Unowned</NativeSelectOption>
              {members.map((m) => (
                <NativeSelectOption key={m.userId} value={m.userId}>
                  {m.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="system-notes">Notes</FieldLabel>
            <Textarea id="system-notes" className="min-h-28" value={draft} disabled={!canEdit} onChange={(e) => setDraft(e.target.value)} />
            {canEdit && (
              <Button variant="outline" className="self-start" disabled={pending || draft === notes} onClick={() => act(() => updateSystemAction(projectSlug, systemSlug, { notes: draft }))}>
                Save notes
              </Button>
            )}
          </Field>
          {canEdit && planningComplete && (
            <Button variant="ghost" className="self-start" disabled={pending} onClick={() => act(() => reopenPlanningAction(projectSlug, systemSlug))}>
              Reopen planning
            </Button>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
```

`src/components/planning-rounds.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { PlanningRoundView } from "@/lib/ops/planning";
import { Markdown } from "./markdown";

/** Every planning round with its questions, area, risk marker, state and answer, then the user's confirmation. */
export function PlanningRounds({ rounds, confirmation }: { rounds: PlanningRoundView[]; confirmation: string | null }) {
  if (rounds.length === 0) return <p className="text-sm text-muted-foreground">The planning interview has not started.</p>;
  return (
    <div className="flex flex-col gap-4">
      {rounds.map((r) => (
        <section key={r.number} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Round {r.number} <span className="font-normal text-muted-foreground">· {r.author} · {r.createdAt.toISOString().slice(0, 10)}</span>
          </h3>
          <ol className="flex flex-col gap-2">
            {r.items.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{i.area}</Badge>
                  {i.isRisk && <Badge variant="destructive">risk</Badge>}
                  <Badge variant={i.status === "open" ? "outline" : "secondary"}>{i.status}</Badge>
                </div>
                <p className="text-sm font-medium">{i.question}</p>
                {i.answer && <Markdown className="text-sm text-muted-foreground">{i.answer}</Markdown>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {confirmation && (
        <blockquote className="border-l-2 border-primary pl-3 text-sm">
          <span className="font-medium">Confirmed by the user:</span> {confirmation}
        </blockquote>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the system page**

`src/app/(app)/p/[project]/systems/[system]/page.tsx`:

```tsx
import Link from "next/link";
import { DocumentSection } from "@/components/document-section";
import { HistoryList } from "@/components/history-list";
import { Markdown } from "@/components/markdown";
import { PlanningRounds } from "@/components/planning-rounds";
import { SystemEditor } from "@/components/system-editor";
import { TaskList } from "@/components/task-list";
import { UpdateList } from "@/components/update-list";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listActivity } from "@/lib/ops/activity";
import { formatAdrNumber } from "@/lib/ops/adrs";
import { getDocument } from "@/lib/ops/documents";
import { listMembers } from "@/lib/ops/members";
import { getSystemOverview } from "@/lib/ops/overview";
import { getPlanning } from "@/lib/ops/planning";
import { listUpdates } from "@/lib/ops/updates";
import { pageData, toIso } from "@/lib/page";

/** Parses a version search parameter, or returns undefined for the latest. */
function version(value: string | string[] | undefined): number | undefined {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * One system: header, spec and plan (with version pickers), open questions, the
 * task list, then Planning, Agent updates and History in accordions that start closed.
 */
export default async function SystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; system: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, system: systemSlug } = await params;
  const sp = await searchParams;
  const data = await pageData(async (db, actor) => {
    const overview = await getSystemOverview(db, actor, slug, systemSlug);
    return {
      overview,
      spec: version(sp.spec) ? await getDocument(db, actor, slug, systemSlug, "spec", version(sp.spec)) : overview.spec,
      plan: version(sp.plan) ? await getDocument(db, actor, slug, systemSlug, "plan", version(sp.plan)) : overview.plan,
      planning: await getPlanning(db, actor, slug, systemSlug),
      updates: await listUpdates(db, actor, slug, { system: systemSlug, limit: 200 }),
      history: await listActivity(db, actor, slug, { system: systemSlug, limit: 300 }),
      members: await listMembers(db, actor, slug),
    };
  });
  const { overview: o } = data;
  const canEdit = o.role !== "viewer";
  const members = data.members.map((m) => ({ userId: m.userId, name: m.name }));
  const openQuestions = o.questions.filter((q) => !q.resolved);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/p/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← Catalogue
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">
          {[o.domain?.name, o.phase?.name, o.board.name].filter(Boolean).join(" · ")}
        </p>
        <h1 className="text-2xl font-semibold">{o.system.title}</h1>
        {o.system.summary && <p className="mt-1 max-w-3xl text-muted-foreground">{o.system.summary}</p>}
        {o.adrs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.adrs.map((a) => (
              <Badge key={a.number} variant="outline" asChild>
                <Link href={`/p/${slug}/adrs/${a.number}`}>
                  ADR {formatAdrNumber(a.number)}: {a.title}
                </Link>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!o.planning.complete && (
            <Alert>
              <AlertTitle>Planning is not complete</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {o.planning.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DocumentSection title="Specification" doc={data.spec} param="spec" empty="No spec yet. It is written at the end of the planning interview." />
          {data.plan && <DocumentSection title="Implementation plan" doc={data.plan} param="plan" empty="" />}
          {openQuestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Open questions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {openQuestions.map((q) => (
                    <li key={q.id}>
                      <span className="font-medium">{q.title}</span>
                      {q.text && <Markdown className="text-muted-foreground">{q.text}</Markdown>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <TaskList
            projectSlug={slug}
            systemSlug={systemSlug}
            tasks={o.tasks}
            members={members}
            canEdit={canEdit}
            planningComplete={o.planning.complete}
          />

          <Accordion type="multiple" className="rounded-lg border px-4">
            <AccordionItem value="planning">
              <AccordionTrigger>
                Planning ({data.planning.rounds.reduce((n, r) => n + r.items.length, 0)})
              </AccordionTrigger>
              <AccordionContent>
                <PlanningRounds rounds={data.planning.rounds} confirmation={data.planning.confirmation} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="updates">
              <AccordionTrigger>Agent updates ({data.updates.length})</AccordionTrigger>
              <AccordionContent>
                <UpdateList updates={data.updates.map(toIso)} projectSlug={slug} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="history">
              <AccordionTrigger>History ({data.history.length})</AccordionTrigger>
              <AccordionContent>
                <HistoryList entries={data.history.map(toIso)} showEntity />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <aside className="flex flex-col gap-4">
          <SystemEditor
            key={`${o.system.columnId}-${o.system.priority}-${o.system.ownerUserId}-${o.system.notes}`}
            projectSlug={slug}
            systemSlug={systemSlug}
            columnId={o.system.columnId}
            columns={o.board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
            planningComplete={o.planning.complete}
            priority={o.system.priority}
            ownerUserId={o.system.ownerUserId}
            notes={o.system.notes}
            members={members}
            canEdit={canEdit}
          />
        </aside>
      </div>
    </div>
  );
}
```

`Accordion type="multiple"` without `defaultValue` renders every item closed.

- [ ] **Step 5: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add the system page with tasks above collapsed planning, updates and history"
```

---

### Task 6.6: ADRs, questions, updates, members, activity and settings pages

**Files:**
- Create: `src/app/(app)/p/[project]/adrs/page.tsx`, `src/app/(app)/p/[project]/adrs/[number]/page.tsx`, `src/components/accept-adr-button.tsx`, `src/app/(app)/p/[project]/questions/page.tsx`, `src/components/question-card.tsx`, `src/app/(app)/p/[project]/updates/page.tsx`, `src/app/(app)/p/[project]/members/page.tsx`, `src/components/member-manager.tsx`, `src/app/(app)/p/[project]/activity/page.tsx`, `src/app/(app)/p/[project]/settings/page.tsx`, `src/components/project-settings.tsx`, `src/components/structure-manager.tsx`

- [ ] **Step 1: ADR list and detail**

`src/app/(app)/p/[project]/adrs/page.tsx`:

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAdrNumber, listAdrs } from "@/lib/ops/adrs";
import { pageData } from "@/lib/page";

/** The project's decision records by number. */
export default async function AdrsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const adrs = await pageData((db, actor) => listAdrs(db, actor, slug));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="ADRs" title="Decisions" description="Accepted records are immutable; a changed decision is a new ADR that supersedes the old one." />
      {adrs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No ADRs yet</EmptyTitle>
            <EmptyDescription>Agents record decisions you make with surf-roadmap:new-adr.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adrs.map((a) => (
                  <TableRow key={a.number}>
                    <TableCell className="font-mono">{formatAdrNumber(a.number)}</TableCell>
                    <TableCell>
                      <Link href={`/p/${slug}/adrs/${a.number}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === "accepted" ? "default" : a.status === "proposed" ? "outline" : "secondary"}>
                        {a.status}
                        {a.supersededBy ? ` by ${formatAdrNumber(a.supersededBy)}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.systems.join(", ")}</TableCell>
                    <TableCell className="text-muted-foreground">{(a.acceptedAt ?? a.createdAt).toISOString().slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

`src/components/accept-adr-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { acceptAdrAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";

/** Accepts a proposed ADR. */
export function AcceptAdrButton({ projectSlug, number }: { projectSlug: string; number: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await acceptAdrAction(projectSlug, number);
          if (result.ok) toast.success("ADR accepted");
          else toast.error(result.error);
        })
      }
    >
      Accept
    </Button>
  );
}
```

`src/app/(app)/p/[project]/adrs/[number]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptAdrButton } from "@/components/accept-adr-button";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAdrNumber, getAdr } from "@/lib/ops/adrs";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** One ADR with its four sections and its supersede links. */
export default async function AdrPage({ params }: { params: Promise<{ project: string; number: string }> }) {
  const { project: slug, number: raw } = await params;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) notFound();
  const { adr, role } = await pageData(async (db, actor) => ({ adr: await getAdr(db, actor, slug, number), role: (await getProject(db, actor, slug)).role }));
  const sections = [
    ["Context", adr.context],
    ["Decision", adr.decision],
    ["Alternatives considered", adr.alternatives],
    ["Consequences", adr.consequences],
  ] as const;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        eyebrow={`ADR ${formatAdrNumber(adr.number)}`}
        title={adr.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{adr.status}</Badge>
            {adr.author} · {adr.createdAt.toISOString().slice(0, 10)}
            {adr.supersedes && (
              <Link href={`/p/${slug}/adrs/${adr.supersedes}`} className="underline">
                supersedes {formatAdrNumber(adr.supersedes)}
              </Link>
            )}
            {adr.supersededBy && (
              <Link href={`/p/${slug}/adrs/${adr.supersededBy}`} className="underline">
                superseded by {formatAdrNumber(adr.supersededBy)}
              </Link>
            )}
            {adr.systems.map((s) => (
              <Link key={s} href={`/p/${slug}/systems/${s}`} className="underline">
                {s}
              </Link>
            ))}
          </span>
        }
        actions={adr.status === "proposed" && role !== "viewer" && <AcceptAdrButton projectSlug={slug} number={adr.number} />}
      />
      {sections.map(([title, body]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown>{body}</Markdown>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Questions and updates**

`src/components/question-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { answerQuestionAction, setQuestionResolvedAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";

/** A question as the questions page passes it in. */
export interface QuestionView {
  id: string;
  title: string;
  text: string;
  answer: string | null;
  resolved: boolean;
  systemSlug: string | null;
  systemTitle: string | null;
  author: string;
}

/** One question with its answer, an answer form and the resolved toggle. */
export function QuestionCard({ projectSlug, question: q, canEdit }: { projectSlug: string; question: QuestionView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState("");
  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle className={q.resolved ? "text-muted-foreground line-through" : ""}>{q.title}</CardTitle>
        <CardDescription>
          {q.author}
          {q.systemSlug && (
            <>
              {" · "}
              <Link href={`/p/${projectSlug}/systems/${q.systemSlug}`} className="underline">
                {q.systemTitle}
              </Link>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.text && <Markdown className="text-sm">{q.text}</Markdown>}
        {q.answer && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">Answer:</span> <Markdown>{q.answer}</Markdown>
          </div>
        )}
        {canEdit && !q.resolved && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await answerQuestionAction(projectSlug, { id: q.id, answer });
                if (!result.ok) return void toast.error(result.error);
                setAnswer("");
              });
            }}
          >
            <Textarea aria-label={`Answer to ${q.title}`} placeholder="Answer and resolve" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <Button type="submit" variant="outline" className="self-start" disabled={pending || !answer.trim()}>
              Answer
            </Button>
          </form>
        )}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`resolved-${q.id}`}
              checked={q.resolved}
              disabled={pending}
              onCheckedChange={(checked) =>
                startTransition(async () => {
                  const result = await setQuestionResolvedAction(projectSlug, q.id, checked === true);
                  if (!result.ok) toast.error(result.error);
                })
              }
            />
            <Label htmlFor={`resolved-${q.id}`}>Resolved</Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

`src/app/(app)/p/[project]/questions/page.tsx`:

```tsx
import { PageHeader } from "@/components/page-header";
import { QuestionCard } from "@/components/question-card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getProject } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { pageData } from "@/lib/page";

/** Open questions of the project, unresolved first. */
export default async function QuestionsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { questions, role } = await pageData(async (db, actor) => ({
    questions: await listQuestions(db, actor, slug),
    role: (await getProject(db, actor, slug)).role,
  }));
  const open = questions.filter((q) => !q.resolved).length;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader eyebrow="Questions" title={`${open} open`} />
      {questions.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No questions</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {questions.map((q) => (
        <QuestionCard key={q.id} projectSlug={slug} question={q} canEdit={role !== "viewer"} />
      ))}
    </div>
  );
}
```

`src/app/(app)/p/[project]/updates/page.tsx`:

```tsx
import { PageHeader } from "@/components/page-header";
import { UpdateList } from "@/components/update-list";
import { listUpdates } from "@/lib/ops/updates";
import { pageData, toIso } from "@/lib/page";

/** Feed of every progress update in the project, newest first. */
export default async function UpdatesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const updates = await pageData((db, actor) => listUpdates(db, actor, slug, { limit: 200 }));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader eyebrow="Updates" title="What the project is up to" description="Progress posted by agents and people, newest first." />
      <UpdateList updates={updates.map(toIso)} showSystem projectSlug={slug} />
    </div>
  );
}
```

- [ ] **Step 3: Members and activity**

`src/components/member-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { removeMemberAction, setMemberAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PROJECT_ROLES, type ProjectRole } from "@/db/schema";

/** Members with role menus and removal, and a form adding a provisioned user. Owners edit; others read. */
export function MemberManager({
  projectSlug,
  members,
  users,
  canOwn,
}: {
  projectSlug: string;
  members: { userId: string; name: string; role: ProjectRole }[];
  users: { id: string; name: string }[];
  canOwn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const candidates = users.filter((u) => !members.some((m) => m.userId === u.id));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
    });

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      {canOwn && (
        <Card>
          <CardContent>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => setMemberAction(projectSlug, { userId, role }));
                setUserId("");
              }}
            >
              <NativeSelect aria-label="User" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <NativeSelectOption value="">Choose a user…</NativeSelectOption>
                {candidates.map((u) => (
                  <NativeSelectOption key={u.id} value={u.id}>
                    {u.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {r}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button type="submit" disabled={pending || !userId}>
                Add member
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {canOwn && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    {canOwn ? (
                      <NativeSelect
                        size="sm"
                        aria-label={`Role of ${m.name}`}
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => act(() => setMemberAction(projectSlug, { userId: m.userId, role: e.target.value as ProjectRole }))}
                      >
                        {PROJECT_ROLES.map((r) => (
                          <NativeSelectOption key={r} value={r}>
                            {r}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      m.role
                    )}
                  </TableCell>
                  {canOwn && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => removeMemberAction(projectSlug, m.userId))}>
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/app/(app)/p/[project]/members/page.tsx`:

```tsx
import { MemberManager } from "@/components/member-manager";
import { PageHeader } from "@/components/page-header";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listUsers } from "@/lib/ops/users";
import { pageData } from "@/lib/page";

/** Project members and their roles. */
export default async function MembersPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => ({
    role: (await getProject(db, actor, slug)).role,
    members: await listMembers(db, actor, slug),
    users: await listUsers(db),
  }));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader eyebrow="Members" title="Who works on this project" description="Viewers read, editors change content, owners also manage members, boards and settings." />
      <MemberManager
        projectSlug={slug}
        members={data.members}
        users={data.users}
        canOwn={data.role === "owner" || data.role === "admin"}
      />
    </div>
  );
}
```

`src/app/(app)/p/[project]/activity/page.tsx`:

```tsx
import { HistoryList } from "@/components/history-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { listActivity } from "@/lib/ops/activity";
import { pageData, toIso } from "@/lib/page";

/** The project's change log, newest first. */
export default async function ActivityPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const entries = await pageData((db, actor) => listActivity(db, actor, slug, { limit: 300 }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Activity" title="Recent changes" />
      <Card>
        <CardContent>
          <HistoryList entries={entries.map(toIso)} showEntity />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Settings (project fields, domains, phases, delete)**

`src/components/project-settings.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteProjectAction, updateProjectAction } from "@/app/(app)/p/[project]/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Owner form for the project's name, description and repository URL, and project deletion. */
export function ProjectSettings({ slug, name, description, repoUrl }: { slug: string; name: string; description: string; repoUrl: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ name, description, repoUrl: repoUrl ?? "" });
  const [confirm, setConfirm] = useState("");
  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await updateProjectAction(slug, { ...draft, repoUrl: draft.repoUrl.trim() || null });
                if (result.ok) toast.success("Saved");
                else toast.error(result.error);
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                <Input id="settings-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-description">Description</FieldLabel>
                <Textarea id="settings-description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-repo">Repository URL</FieldLabel>
                <Input id="settings-repo" value={draft.repoUrl} onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })} />
              </Field>
              <Button type="submit" className="self-start" disabled={pending}>
                Save
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete project</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {name} and everything in it?</AlertDialogTitle>
                <AlertDialogDescription>
                  Boards, systems, specs, plans, ADRs, questions and history are removed. Type the slug <code>{slug}</code> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input aria-label="Project slug" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={confirm !== slug}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteProjectAction(slug);
                      if (!result.ok) return void toast.error(result.error);
                      router.push("/");
                    })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/components/structure-manager.tsx`:

```tsx
"use client";

import { TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createDomainAction, createPhaseAction, deleteDomainAction, deletePhaseAction } from "@/app/(app)/p/[project]/actions";
import type { ActionResult } from "@/app/actions/run";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Lists domains and phases with delete buttons and forms to add them. Editors and above. */
export function StructureManager({
  projectSlug,
  domains,
  phases,
}: {
  projectSlug: string;
  domains: { id: string; name: string; description: string }[];
  phases: { id: string; name: string; goal: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [phase, setPhase] = useState("");
  const [goal, setGoal] = useState("");

  /** Runs an action and toasts its error. */
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
    });

  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy={pending}>
      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>Areas that group systems, such as Police or Vehicles.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="divide-y rounded-md border">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{d.name}</span>
                <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} onClick={() => act(() => deleteDomainAction(projectSlug, d.id))}>
                  <TrashIcon />
                </Button>
              </li>
            ))}
            {domains.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No domains.</li>}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => createDomainAction(projectSlug, { name: domain }));
              setDomain("");
            }}
          >
            <Input aria-label="New domain" placeholder="New domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Button type="submit" variant="outline" disabled={pending || !domain.trim()}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Phases</CardTitle>
          <CardDescription>Delivery phases in order, shown on the roadmap.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="divide-y rounded-md border">
            {phases.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  {p.name}
                  {p.goal && <span className="text-muted-foreground"> · {p.goal}</span>}
                </span>
                <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => act(() => deletePhaseAction(projectSlug, p.id))}>
                  <TrashIcon />
                </Button>
              </li>
            ))}
            {phases.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No phases.</li>}
          </ol>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => createPhaseAction(projectSlug, { name: phase, goal }));
              setPhase("");
              setGoal("");
            }}
          >
            <Input aria-label="New phase" placeholder="New phase" value={phase} onChange={(e) => setPhase(e.target.value)} />
            <Input aria-label="Goal" placeholder="Goal (optional)" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <Button type="submit" variant="outline" className="self-start" disabled={pending || !phase.trim()}>
              Add phase
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/app/(app)/p/[project]/settings/page.tsx`:

```tsx
import { PageHeader } from "@/components/page-header";
import { ProjectSettings } from "@/components/project-settings";
import { StructureManager } from "@/components/structure-manager";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { pageData } from "@/lib/page";

/** Project settings: fields and deletion for owners, domains and phases for editors. */
export default async function SettingsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    domains: await listDomains(db, actor, slug),
    phases: await listPhases(db, actor, slug),
  }));
  const { project, role } = data.detail;
  const canOwn = role === "owner" || role === "admin";
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader eyebrow="Settings" title={project.name} />
      {role !== "viewer" && <StructureManager projectSlug={slug} domains={data.domains} phases={data.phases} />}
      {canOwn && <ProjectSettings slug={slug} name={project.name} description={project.description} repoUrl={project.repoUrl} />}
      {role === "viewer" && <p className="text-sm text-muted-foreground">Viewers cannot change settings.</p>}
    </div>
  );
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add ADR, question, update, member, activity and settings pages"
```

- [ ] **Step 6: Manual walkthrough with the dev server**

With `npm run dev`, as the admin from Part 2:
1. Create a project; it opens on an empty catalogue with **New system**.
2. Create a board **Building**; its tab appears; **Edit columns**, rename **Todo** to **Sketch**, save.
3. Create a system on **Building**; on the board it sits in **Planning**; dragging it to **Sketch** shows the planning toast with the gaps.
4. Open the system: the order is Specification, Tasks, then **Planning (0)**, **Agent updates (0)**, **History (1)**, all collapsed; the Column menu disables non-planning columns.
5. Switch to dark mode in the OS: colours follow.

Record anything that does not match as a bug before continuing.
