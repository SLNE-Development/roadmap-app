# Part 2: Auth, allowlist and API keys

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** Discord sign-in through Better Auth for provisioned accounts only (first user becomes admin), an admin page for the allowlist, per-user API keys with a key page, and one `Actor` resolved from either a session or a bearer key.

**Spec:** sections 5.1, 6, 7 (login, API keys, admin), 11 (environment).

**Consumes from Part 1:** `Db`, `Executor`, `getDb()`, `runMigrations()`, tables `user`, `session`, `account`, `verification`, `apikey`, `allowedAccount`, `Actor`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `isUniqueViolation`, `messageOf`, `createTestDb()`, `insertUser()`.

---

### Task 2.1: Account ops (allowlist, admins, actor loading)

**Files:**
- Create: `src/lib/ops/users.ts`
- Test: `src/lib/ops/users.test.ts`

**Interfaces:**
- Produces:
  - `type SignInVerdict = "first-user" | "allowed" | "rejected"`
  - `checkSignIn(db: Executor, discordId: string): Promise<SignInVerdict>`
  - `isAllowed(db: Executor, discordId: string): Promise<boolean>`
  - `loadActor(db: Executor, userId: string): Promise<Actor | null>` — null when the user is unknown or no longer provisioned
  - `addAllowedAccountInput` (zod: `discordId` 15–21 digits, `displayName` 1–60 chars)
  - `listAllowedAccounts(db: Db, actor: Actor): Promise<AllowedAccountRow[]>` where `AllowedAccountRow = { discordId: string; displayName: string; createdAt: Date; userId: string | null; userName: string | null; isAdmin: boolean }`
  - `addAllowedAccount(db: Db, actor: Actor, input: z.input<typeof addAllowedAccountInput>): Promise<void>`
  - `removeAllowedAccount(db: Db, actor: Actor, discordId: string): Promise<void>` — deletes the user's sessions and API keys
  - `setAdmin(db: Db, actor: Actor, userId: string, isAdmin: boolean): Promise<void>`
  - `listUsers(db: Executor): Promise<{ id: string; name: string; image: string | null }[]>` — provisioned users, by name

- [ ] **Step 1: Write the failing tests**

`src/lib/ops/users.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { apikey, session, user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import {
  addAllowedAccount,
  checkSignIn,
  listAllowedAccounts,
  listUsers,
  loadActor,
  removeAllowedAccount,
  setAdmin,
} from "./users";

describe("checkSignIn", () => {
  it("lets the very first account in", async () => {
    const db = await createTestDb();
    expect(await checkSignIn(db, "123456789012345678")).toBe("first-user");
  });

  it("afterwards admits only provisioned Discord ids", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    expect(await checkSignIn(db, "223456789012345678")).toBe("allowed");
    expect(await checkSignIn(db, "999999999999999999")).toBe("rejected");
    expect(await checkSignIn(db, "")).toBe("rejected");
  });
});

describe("allowlist management", () => {
  it("is admin-only", async () => {
    const db = await createTestDb();
    const member = await insertUser(db);
    await expect(addAllowedAccount(db, member, { discordId: "223456789012345678", displayName: "Sam" })).rejects.toThrow(
      "Only admins can manage accounts.",
    );
    await expect(listAllowedAccounts(db, member)).rejects.toThrow("Only admins");
  });

  it("rejects malformed and duplicate Discord ids", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(addAllowedAccount(db, admin, { discordId: "abc", displayName: "Sam" })).rejects.toThrow(/15 to 21 digits/);
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    await expect(addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" })).rejects.toThrow(
      "Discord id 223456789012345678 is already added.",
    );
  });

  it("lists accounts with the user they became", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { name: "Ada", isAdmin: true, discordId: "123456789012345678" });
    await addAllowedAccount(db, admin, { discordId: "223456789012345678", displayName: "Sam" });
    const rows = await listAllowedAccounts(db, admin);
    expect(rows.map((r) => [r.displayName, r.userName, r.isAdmin])).toEqual([
      ["Ada", "Ada", true],
      ["Sam", null, false],
    ]);
  });
});

describe("removing an account", () => {
  it("ends the user's sessions and revokes their keys immediately", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db, { name: "Sam", discordId: "223456789012345678" });
    await db.insert(session).values({ id: "s1", token: "t1", userId: sam.userId, expiresAt: new Date(Date.now() + 1e7) });
    await db.insert(apikey).values({ id: "k1", key: "hash", referenceId: sam.userId });
    expect(await loadActor(db, sam.userId)).toMatchObject({ name: "Sam" });

    await removeAllowedAccount(db, admin, "223456789012345678");

    expect(await loadActor(db, sam.userId)).toBeNull();
    expect(await db.select().from(session)).toEqual([]);
    expect(await db.select().from(apikey)).toEqual([]);
    expect(await db.select().from(user)).toHaveLength(2);
  });

  it("refuses to remove the last admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true, discordId: "123456789012345678" });
    await expect(removeAllowedAccount(db, admin, "123456789012345678")).rejects.toThrow("You cannot remove the last admin.");
  });

  it("reports an unknown Discord id", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(removeAllowedAccount(db, admin, "999999999999999999")).rejects.toThrow("Unknown Discord id 999999999999999999.");
  });
});

describe("setAdmin", () => {
  it("grants and revokes admin but keeps at least one admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const sam = await insertUser(db);
    await setAdmin(db, admin, sam.userId, true);
    expect((await loadActor(db, sam.userId))?.isAdmin).toBe(true);
    await setAdmin(db, admin, sam.userId, false);
    await expect(setAdmin(db, admin, admin.userId, false)).rejects.toThrow("The last admin cannot drop the admin flag.");
  });
});

describe("listUsers", () => {
  it("lists only provisioned users, by name", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { name: "Zed", isAdmin: true });
    await insertUser(db, { name: "Amy", discordId: "223456789012345678" });
    await removeAllowedAccount(db, admin, "223456789012345678");
    await insertUser(db, { name: "Bob" });
    expect((await listUsers(db)).map((u) => u.name)).toEqual(["Bob", "Zed"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/ops/users.test.ts`
Expected: FAIL, `./users` not found.

- [ ] **Step 3: Implement**

`src/lib/ops/users.ts`:

```ts
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { allowedAccount, apikey, session, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError } from "./errors";

/** Outcome of a sign-in attempt: the bootstrap admin, a provisioned account, or a rejection. */
export type SignInVerdict = "first-user" | "allowed" | "rejected";

/** A provisioned Discord account together with the user it became, if they signed in. */
export interface AllowedAccountRow {
  discordId: string;
  displayName: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
}

/** Input of {@link addAllowedAccount}. */
export const addAllowedAccountInput = z.object({
  discordId: z.string().trim().regex(/^\d{15,21}$/, "a Discord user id is 15 to 21 digits"),
  displayName: z.string().trim().min(1).max(60),
});

/** Throws unless the actor is an admin. */
function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can manage accounts.");
}

/** Returns how many users carry the admin flag. */
async function adminCount(db: Executor): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user).where(eq(user.isAdmin, true));
  return row.n;
}

/** Returns whether `discordId` is on the allowlist; an empty id never is. */
export async function isAllowed(db: Executor, discordId: string): Promise<boolean> {
  if (!discordId) return false;
  const rows = await db
    .select({ id: allowedAccount.discordId })
    .from(allowedAccount)
    .where(eq(allowedAccount.discordId, discordId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Decides whether a Discord account may sign in: while no user exists the first
 * account is admitted as admin; afterwards only provisioned ids are admitted.
 */
export async function checkSignIn(db: Executor, discordId: string): Promise<SignInVerdict> {
  const [row] = await db.select({ n: count() }).from(user);
  if (row.n === 0) return "first-user";
  return (await isAllowed(db, discordId)) ? "allowed" : "rejected";
}

/**
 * Returns the actor for a user, or `null` when the user does not exist or their
 * Discord account is no longer on the allowlist.
 */
export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, isAdmin: user.isAdmin })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(user.id, userId))
    .limit(1);
  return row ? { userId: row.id, name: row.name, isAdmin: row.isAdmin } : null;
}

/** Lists every provisioned account with the user it became, oldest first. Admin only. */
export async function listAllowedAccounts(db: Db, actor: Actor): Promise<AllowedAccountRow[]> {
  requireAdmin(actor);
  const rows = await db
    .select({
      discordId: allowedAccount.discordId,
      displayName: allowedAccount.displayName,
      createdAt: allowedAccount.createdAt,
      userId: user.id,
      userName: user.name,
      isAdmin: user.isAdmin,
    })
    .from(allowedAccount)
    .leftJoin(user, eq(user.discordId, allowedAccount.discordId))
    .orderBy(asc(allowedAccount.createdAt), asc(allowedAccount.displayName));
  return rows.map((r) => ({ ...r, isAdmin: r.isAdmin ?? false }));
}

/**
 * Provisions a Discord account so it can sign in. Admin only.
 *
 * @throws ConflictError if the id is already provisioned
 */
export async function addAllowedAccount(db: Db, actor: Actor, raw: z.input<typeof addAllowedAccountInput>): Promise<void> {
  requireAdmin(actor);
  const input = addAllowedAccountInput.parse(raw);
  try {
    await db.insert(allowedAccount).values({ ...input, createdBy: actor.userId });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Discord id ${input.discordId} is already added.`);
    throw error;
  }
}

/**
 * Removes a provisioned account, ends the user's sessions and deletes their API
 * keys. The user row and project memberships stay but no longer grant access.
 * Admin only.
 *
 * @throws NotFoundError if the id is not provisioned
 * @throws ConflictError if it belongs to the last admin
 */
export async function removeAllowedAccount(db: Db, actor: Actor, discordId: string): Promise<void> {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(allowedAccount).where(eq(allowedAccount.discordId, discordId)).limit(1);
    if (!row) throw new NotFoundError(`Unknown Discord id ${discordId}.`);
    const [target] = await tx.select().from(user).where(eq(user.discordId, discordId)).limit(1);
    if (target) {
      if (target.isAdmin && (await adminCount(tx)) === 1) throw new ConflictError("You cannot remove the last admin.");
      await tx.delete(session).where(eq(session.userId, target.id));
      await tx.delete(apikey).where(eq(apikey.referenceId, target.id));
      if (target.isAdmin) await tx.update(user).set({ isAdmin: false }).where(eq(user.id, target.id));
    }
    await tx.delete(allowedAccount).where(eq(allowedAccount.discordId, discordId));
  });
}

/**
 * Grants or revokes the admin flag. Admin only.
 *
 * @throws NotFoundError if the user does not exist
 * @throws ConflictError if it would leave no admin
 */
export async function setAdmin(db: Db, actor: Actor, userId: string, isAdmin: boolean): Promise<void> {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!target) throw new NotFoundError(`Unknown user ${userId}.`);
    if (target.isAdmin === isAdmin) return;
    if (!isAdmin && (await adminCount(tx)) === 1) throw new ConflictError("The last admin cannot drop the admin flag.");
    await tx.update(user).set({ isAdmin }).where(and(eq(user.id, userId)));
  });
}

/** Lists users whose Discord account is still provisioned, sorted by name. */
export async function listUsers(db: Executor): Promise<{ id: string; name: string; image: string | null }[]> {
  return db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .orderBy(asc(user.name));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/ops/users.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ops/users.ts src/lib/ops/users.test.ts
git commit -m "feat: Add allowlist, admin and actor loading ops"
```

---

### Task 2.2: API key ops and bearer parsing

**Files:**
- Create: `src/lib/ops/api-keys.ts`, `src/lib/auth/bearer.ts`
- Test: `src/lib/ops/api-keys.test.ts`, `src/lib/auth/bearer.test.ts`

**Interfaces:**
- Produces:
  - `listApiKeys(db: Executor, actor: Actor): Promise<ApiKeyRow[]>` where `ApiKeyRow = { id: string; name: string | null; start: string | null; createdAt: Date; expiresAt: Date | null; lastRequest: Date | null }`, newest first, only the actor's keys
  - `revokeApiKey(db: Executor, actor: Actor, id: string): Promise<void>` — `NotFoundError` for another user's key
  - `createApiKeyInput` (zod: `name` 1–32 chars, `expiresInDays` integer 1–365 or null)
  - `bearerToken(header: string | null): string | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/auth/bearer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bearerToken } from "./bearer";

describe("bearerToken", () => {
  it("extracts the token of a Bearer header, case-insensitively", () => {
    expect(bearerToken("Bearer rmk_abc")).toBe("rmk_abc");
    expect(bearerToken("bearer   rmk_abc  ")).toBe("rmk_abc");
  });

  it("rejects missing, empty and other schemes", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
  });
});
```

`src/lib/ops/api-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { apikey } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createApiKeyInput, listApiKeys, revokeApiKey } from "./api-keys";

describe("api keys", () => {
  it("lists only the actor's own keys, newest first, without the hash", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await db.insert(apikey).values([
      { id: "k1", key: "h1", name: "laptop", start: "rmk_ab", referenceId: alex.userId, createdAt: new Date(1000) },
      { id: "k2", key: "h2", name: "ci", start: "rmk_cd", referenceId: alex.userId, createdAt: new Date(2000) },
      { id: "k3", key: "h3", name: "other", referenceId: sam.userId },
    ]);
    const keys = await listApiKeys(db, alex);
    expect(keys.map((k) => k.id)).toEqual(["k2", "k1"]);
    expect(keys[0]).not.toHaveProperty("key");
  });

  it("revokes the actor's key and hides other users' keys", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await db.insert(apikey).values({ id: "k3", key: "h3", referenceId: sam.userId });
    await expect(revokeApiKey(db, alex, "k3")).rejects.toThrow("Unknown API key k3.");
    await revokeApiKey(db, sam, "k3");
    expect(await db.select().from(apikey)).toEqual([]);
  });

  it("validates new key input", () => {
    expect(createApiKeyInput.safeParse({ name: "", expiresInDays: null }).success).toBe(false);
    expect(createApiKeyInput.safeParse({ name: "x".repeat(33), expiresInDays: null }).success).toBe(false);
    expect(createApiKeyInput.safeParse({ name: "laptop", expiresInDays: 400 }).success).toBe(false);
    expect(createApiKeyInput.parse({ name: " laptop ", expiresInDays: 30 })).toEqual({ name: "laptop", expiresInDays: 30 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/auth src/lib/ops/api-keys.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/lib/auth/bearer.ts`:

```ts
/**
 * Returns the token of an `Authorization: Bearer <token>` header value, or `null`
 * when the header is missing, uses another scheme, or the token is empty or contains spaces.
 */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}
```

`src/lib/ops/api-keys.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apikey } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** An API key as shown to its owner: never the key itself. */
export interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
}

/** Input for creating a key: a name and an optional lifetime in days. */
export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(32),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

/** Lists the actor's API keys, newest first. */
export async function listApiKeys(db: Executor, actor: Actor): Promise<ApiKeyRow[]> {
  return db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, actor.userId))
    .orderBy(desc(apikey.createdAt));
}

/**
 * Deletes one of the actor's API keys; it stops working immediately.
 *
 * @throws NotFoundError if the key does not exist or belongs to someone else
 */
export async function revokeApiKey(db: Executor, actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.referenceId, actor.userId)))
    .returning({ id: apikey.id });
  if (deleted.length === 0) throw new NotFoundError(`Unknown API key ${id}.`);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/auth src/lib/ops/api-keys.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ops/api-keys.ts src/lib/ops/api-keys.test.ts src/lib/auth/bearer.ts src/lib/auth/bearer.test.ts
git commit -m "feat: Add API key listing, revocation and bearer parsing"
```

---

### Task 2.3: Better Auth wiring, sign-in, route guard and startup checks

**Files:**
- Create: `src/lib/auth/server.ts`, `src/lib/auth/client.ts`, `src/lib/auth/actor.ts`, `src/app/api/auth/[...all]/route.ts`, `src/proxy.ts`, `src/instrumentation.ts`, `src/app/login/page.tsx`, `src/app/login/sign-in-button.tsx`, `src/app/actions/run.ts`, `src/components/user-menu.tsx`, `src/components/nav.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `.env.example`, `docker-compose.yml`
- Delete: `src/app/page.tsx`

**Interfaces:**
- Consumes: `checkSignIn`, `isAllowed`, `loadActor` (Task 2.1), `bearerToken` (Task 2.2).
- Produces:
  - `getAuth()` — the Better Auth instance (lazy, server only); `NOT_PROVISIONED` message constant.
  - `sessionActor(): Promise<Actor | null>`, `requireActor(): Promise<Actor>` (redirects to `/login`), `bearerActor(request: Request): Promise<Actor | null>` from `@/lib/auth/actor`.
  - `authClient` from `@/lib/auth/client`.
  - `type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string }` and `runAction<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<ActionResult<T>>` from `@/app/actions/run` (checks the session, revalidates every page on success, maps errors with `messageOf`).
  - `<Nav actor={actor}>{children}</Nav>` and `<UserMenu name isAdmin />` — Part 6 passes the project switcher and project links as `children`.

- [ ] **Step 1: Write the Better Auth server config**

`src/lib/auth/server.ts`:

```ts
import "server-only";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { account, allowedAccount, apikey, session, user, verification } from "@/db/schema";
import { checkSignIn, isAllowed } from "@/lib/ops/users";

/** Message shown when a Discord account that was not provisioned tries to sign in. */
export const NOT_PROVISIONED = "Your Discord account has not been added. Ask an admin.";

/**
 * Returns the value of a required environment variable.
 *
 * @throws Error naming the variable when it is unset or empty
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; see .env.example.`);
  return value;
}

/**
 * Builds the Better Auth instance: Discord sign-in for provisioned accounts,
 * the first account as admin, and per-user API keys with the `rmk_` prefix.
 */
function createAuth() {
  const db = getDb();
  return betterAuth({
    baseURL: requireEnv("BETTER_AUTH_URL"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification, apikey } }),
    socialProviders: {
      discord: {
        clientId: requireEnv("DISCORD_CLIENT_ID"),
        clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
        mapProfileToUser: (profile) => ({ discordId: profile.id }),
      },
    },
    user: {
      additionalFields: {
        discordId: { type: "string", required: false, input: false },
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const verdict = await checkSignIn(db, String(data.discordId ?? ""));
            if (verdict === "rejected") throw new APIError("FORBIDDEN", { message: NOT_PROVISIONED });
            return { data: { ...data, isAdmin: verdict === "first-user" } };
          },
          after: async (created) => {
            if (created.isAdmin && created.discordId) {
              await db
                .insert(allowedAccount)
                .values({ discordId: String(created.discordId), displayName: created.name })
                .onConflictDoNothing();
            }
          },
        },
      },
      session: {
        create: {
          before: async (data) => {
            const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, data.userId)).limit(1);
            if (!row?.discordId || !(await isAllowed(db, row.discordId))) {
              throw new APIError("FORBIDDEN", { message: NOT_PROVISIONED });
            }
          },
        },
      },
    },
    plugins: [apiKey({ defaultPrefix: "rmk_", rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 } }), nextCookies()],
  });
}

/** The configured Better Auth instance. */
export type Auth = ReturnType<typeof createAuth>;

/** Lazily created instance, so builds without environment variables do not fail. */
let cached: Auth | undefined;

/** Returns the Better Auth instance, creating it on first use. */
export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}
```

If `npm run typecheck` rejects `mapProfileToUser` returning `discordId` or `created.isAdmin`, cast the returned object as `Record<string, unknown>` and read `created.isAdmin` as `(created as { isAdmin?: boolean }).isAdmin`. Do not change behaviour.

- [ ] **Step 2: Write the client, the actor helpers and the auth route**

`src/lib/auth/client.ts`:

```ts
"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client for sign-in and sign-out. */
export const authClient = createAuthClient({ plugins: [apiKeyClient()] });
```

`src/lib/auth/actor.ts`:

```ts
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { Actor } from "@/lib/ops/actor";
import { loadActor } from "@/lib/ops/users";
import { bearerToken } from "./bearer";
import { getAuth } from "./server";

/** Returns the signed-in actor of the current request, or `null` without a valid, provisioned session. */
export async function sessionActor(): Promise<Actor | null> {
  const found = await getAuth().api.getSession({ headers: await headers() });
  return found ? loadActor(getDb(), found.user.id) : null;
}

/** Returns the signed-in actor, redirecting to `/login` when there is none. */
export async function requireActor(): Promise<Actor> {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * Returns the actor owning the API key in the request's bearer header, or `null`
 * when the key is missing, invalid, expired, rate limited, or its owner is no longer provisioned.
 */
export async function bearerActor(request: Request): Promise<Actor | null> {
  const key = bearerToken(request.headers.get("authorization"));
  if (!key) return null;
  const result = await getAuth().api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  return loadActor(getDb(), result.key.referenceId);
}
```

`src/app/api/auth/[...all]/route.ts`:

```ts
import { getAuth } from "@/lib/auth/server";

/** Better Auth GET endpoints (session, OAuth callback). */
export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

/** Better Auth POST endpoints (sign-in, sign-out, API keys). */
export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
```

- [ ] **Step 3: Write the route guard and the startup checks**

`src/proxy.ts`:

```ts
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends requests without a session cookie to `/login`. This is a fast pre-check;
 * pages and actions verify the session itself.
 *
 * @param request the incoming request
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/** Guards everything except the login page, the API (bearer or Better Auth) and static assets. */
export const config = {
  matcher: ["/((?!login|api/|_next/static|_next/image|favicon.ico).*)"],
};
```

`src/instrumentation.ts`:

```ts
/** Environment variables the server refuses to start without. */
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"];

/** Runs once when the Node server starts: checks the environment, then applies pending migrations. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const name of REQUIRED) {
    if (!process.env[name]) throw new Error(`${name} is not set; see .env.example.`);
  }
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(process.env.DATABASE_URL as string);
}
```

- [ ] **Step 4: Write the login page**

`src/app/login/sign-in-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/** Starts the Discord OAuth flow; failures come back to `/login?error=…`. */
export function SignInButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({ provider: "discord", callbackURL: "/", errorCallbackURL: "/login?error=signin" });
      }}
    >
      {pending ? "Redirecting…" : "Sign in with Discord"}
    </Button>
  );
}
```

`src/app/login/page.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOT_PROVISIONED } from "@/lib/auth/server";
import { SignInButton } from "./sign-in-button";

/**
 * Sign-in page with the Discord button and, after a failed attempt, the reason.
 *
 * @param props.searchParams carries `error` after a rejected sign-in
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription>Roadmap</CardDescription>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>
                {NOT_PROVISIONED} <span className="font-mono text-xs">({error})</span>
              </AlertDescription>
            </Alert>
          )}
          <SignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
```

`NOT_PROVISIONED` is imported from a `server-only` module into a server component, which is allowed.

- [ ] **Step 5: Write the action runner, navigation and the signed-in shell**

`src/app/actions/run.ts`:

```ts
import "server-only";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { sessionActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";

/** Result of a server action: a value, or an error message to show. */
export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs `fn` as the signed-in actor. Server actions are reachable without the
 * route guard, so this checks the session itself, revalidates every page on
 * success, and turns thrown errors into a message.
 */
export async function runAction<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  const actor = await sessionActor();
  if (!actor) return { ok: false, error: "Your session has ended. Sign in again." };
  try {
    const value = await fn(getDb(), actor);
    revalidatePath("/", "layout");
    return { ok: true, value };
  } catch (error) {
    if (statusOf(error) === 500) console.error(error);
    return { ok: false, error: messageOf(error) };
  }
}
```

`src/components/user-menu.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

/** Account menu in the top bar: API keys, Admin for admins, and sign-out. */
export function UserMenu({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          {name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{isAdmin ? "Admin" : "Account"}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings/api-keys">API keys</Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin/users">Accounts</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await authClient.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/components/nav.tsx`:

```tsx
import Link from "next/link";
import type { Actor } from "@/lib/ops/actor";
import { UserMenu } from "./user-menu";

/** Top bar: app name, project navigation passed as `children`, and the account menu. */
export function Nav({ actor, children }: { actor: Actor; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="font-semibold">
          Roadmap
        </Link>
        {children}
        <div className="ml-auto">
          <UserMenu name={actor.name} isAdmin={actor.isAdmin} />
        </div>
      </div>
    </header>
  );
}
```

`src/app/(app)/layout.tsx`:

```tsx
import { Nav } from "@/components/nav";
import { requireActor } from "@/lib/auth/actor";

/** Every signed-in page reads live data. */
export const dynamic = "force-dynamic";

/**
 * Shell for every signed-in page: checks the session, then renders the navigation and a centred column.
 *
 * @param props.children the page content
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <>
      <Nav actor={actor} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
```

`src/app/(app)/page.tsx` (Part 6 replaces it with the project list):

```tsx
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** Signed-in start page. */
export default function HomePage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Projects arrive with the project pages.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
```

Then delete the Part 1 placeholder:

```bash
git rm src/app/page.tsx
```

- [ ] **Step 6: Write `.env.example` and the local Postgres compose file**

`.env.example`:

```bash
# Postgres connection used by the app and its migrations.
DATABASE_URL=postgres://roadmap:roadmap@localhost:5432/roadmap
# Password of the bundled Postgres service (docker compose only).
POSTGRES_PASSWORD=roadmap
# Random secret that signs sessions. Generate one with: openssl rand -base64 32
BETTER_AUTH_SECRET=
# Public base URL of the app, without a trailing slash.
BETTER_AUTH_URL=http://localhost:3000
# Discord OAuth application: https://discord.com/developers/applications
# Register this redirect URL there: <BETTER_AUTH_URL>/api/auth/callback/discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
```

`docker-compose.yml` (Part 8 adds the app service):

```yaml
# Local development: a lean Postgres. Part of the full stack in docker-compose.coolify.yml.
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: roadmap
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-roadmap}
      POSTGRES_DB: roadmap
    command:
      - postgres
      - -c
      - shared_buffers=32MB
      - -c
      - max_connections=20
      - -c
      - work_mem=2MB
      - -c
      - maintenance_work_mem=16MB
      - -c
      - effective_cache_size=64MB
    ports:
      - "5432:5432"
    volumes:
      - roadmap-db:/var/lib/postgresql/data
    mem_limit: 256m
    cpus: 0.5
    restart: unless-stopped

volumes:
  roadmap-db:
```

- [ ] **Step 7: Verify**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all green; the build lists `/login`, `/`, `/api/auth/[...all]` and `Proxy (Middleware)`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Add Discord sign-in with allowlist through Better Auth"
```

---

### Task 2.4: Admin users page and API keys page

**Files:**
- Create: `src/app/(app)/admin/users/page.tsx`, `src/app/(app)/admin/users/actions.ts`, `src/components/allowlist-manager.tsx`, `src/app/(app)/settings/api-keys/page.tsx`, `src/app/(app)/settings/api-keys/actions.ts`, `src/components/api-key-manager.tsx`

**Interfaces:**
- Consumes: `listAllowedAccounts`, `addAllowedAccount`, `removeAllowedAccount`, `setAdmin` (2.1); `listApiKeys`, `revokeApiKey`, `createApiKeyInput` (2.2); `getAuth`, `requireActor`, `runAction` (2.3).
- Produces server actions `addAccountAction(input)`, `removeAccountAction(discordId)`, `setAdminAction(userId, isAdmin)`, `createApiKeyAction(input): Promise<ActionResult<{ key: string }>>`, `revokeApiKeyAction(id)`.

- [ ] **Step 1: Write the admin actions and page**

`src/app/(app)/admin/users/actions.ts`:

```ts
"use server";

import { runAction } from "@/app/actions/run";
import { addAllowedAccount, removeAllowedAccount, setAdmin } from "@/lib/ops/users";

/** Provisions a Discord account. */
export async function addAccountAction(input: { discordId: string; displayName: string }) {
  return runAction((db, actor) => addAllowedAccount(db, actor, input));
}

/** Removes a provisioned account, ending its sessions and keys. */
export async function removeAccountAction(discordId: string) {
  return runAction((db, actor) => removeAllowedAccount(db, actor, discordId));
}

/** Grants or revokes admin. */
export async function setAdminAction(userId: string, isAdmin: boolean) {
  return runAction((db, actor) => setAdmin(db, actor, userId, isAdmin));
}
```

`src/components/allowlist-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addAccountAction, removeAccountAction, setAdminAction } from "@/app/(app)/admin/users/actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A provisioned account row as the page passes it in. */
export interface AccountItem {
  discordId: string;
  displayName: string;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
}

/** Lists provisioned Discord accounts with admin toggles, removal and a form to add one. */
export function AllowlistManager({ accounts, selfId }: { accounts: AccountItem[]; selfId: string }) {
  const [pending, startTransition] = useTransition();
  const [discordId, setDiscordId] = useState("");
  const [displayName, setDisplayName] = useState("");

  /** Runs an action, toasting its error or `success`, and returns whether it worked. */
  const act = (fn: () => Promise<ActionResult>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else {
        if (success) toast.success(success);
        after?.();
      }
    });

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = { discordId, displayName };
              act(() => addAccountAction(input), `Added ${input.displayName}`, () => {
                setDiscordId("");
                setDisplayName("");
              });
            }}
          >
            <Input
              id="new-discord-id"
              aria-label="Discord user id"
              placeholder="Discord user id"
              inputMode="numeric"
              className="min-w-48 flex-1 font-mono"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
            />
            <Input
              id="new-display-name"
              aria-label="Display name"
              placeholder="Display name"
              className="min-w-40 flex-1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Button type="submit" disabled={pending || !discordId.trim() || !displayName.trim()}>
              Add account
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Discord id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.discordId}>
                  <TableCell className="font-medium">{a.displayName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.discordId}</TableCell>
                  <TableCell>
                    {a.userName ? <Badge variant="secondary">signed in as {a.userName}</Badge> : <Badge variant="outline">not signed in yet</Badge>}
                  </TableCell>
                  <TableCell>
                    {a.userId && (
                      <Checkbox
                        aria-label={`Admin: ${a.displayName}`}
                        checked={a.isAdmin}
                        disabled={pending}
                        onCheckedChange={(checked) => act(() => setAdminAction(a.userId as string, checked === true))}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={pending || a.userId === selfId}>
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {a.displayName}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They are signed out everywhere and their API keys stop working. Their project memberships stay but grant nothing.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => act(() => removeAccountAction(a.discordId), `Removed ${a.displayName}`)}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
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

`src/app/(app)/admin/users/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { AllowlistManager } from "@/components/allowlist-manager";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { listAllowedAccounts } from "@/lib/ops/users";

/** Admin page listing provisioned Discord accounts; non-admins get a 404. */
export default async function AdminUsersPage() {
  const actor = await requireActor();
  if (!actor.isAdmin) notFound();
  const accounts = await listAllowedAccounts(getDb(), actor);
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">Admin</p>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Only these Discord accounts can sign in. Find an id in Discord with Developer Mode on: right-click the user, Copy User ID.
        </p>
      </div>
      <AllowlistManager accounts={accounts} selfId={actor.userId} />
    </div>
  );
}
```

- [ ] **Step 2: Write the API key actions and page**

`src/app/(app)/settings/api-keys/actions.ts`:

```ts
"use server";

import { runAction } from "@/app/actions/run";
import { getAuth } from "@/lib/auth/server";
import { createApiKeyInput, revokeApiKey } from "@/lib/ops/api-keys";

/** Creates an API key for the signed-in user and returns the key once. */
export async function createApiKeyAction(input: { name: string; expiresInDays: number | null }) {
  return runAction(async (_db, actor) => {
    const { name, expiresInDays } = createApiKeyInput.parse(input);
    const created = await getAuth().api.createApiKey({
      body: { name, expiresIn: expiresInDays ? expiresInDays * 86_400 : null, userId: actor.userId },
    });
    return { key: created.key };
  });
}

/** Revokes one of the signed-in user's keys. */
export async function revokeApiKeyAction(id: string) {
  return runAction((db, actor) => revokeApiKey(db, actor, id));
}
```

`src/components/api-key-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/settings/api-keys/actions";
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
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** An API key row as the page passes it in, with dates as ISO strings. */
export interface ApiKeyItem {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
}

/** Lists the user's keys, creates new ones (shown once with the env lines) and revokes them. */
export function ApiKeyManager({ keys, appUrl }: { keys: ApiKeyItem[]; appUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const envLines = created ? `ROADMAP_URL=${appUrl}\nROADMAP_API_KEY=${created}` : "";

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await createApiKeyAction({ name, expiresInDays: days ? Number(days) : null });
                if (!result.ok) return void toast.error(result.error);
                setCreated(result.value.key);
                setName("");
                setDays("");
              });
            }}
          >
            <Input
              id="key-name"
              aria-label="Key name"
              placeholder="Name, e.g. laptop"
              maxLength={32}
              className="min-w-40 flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              id="key-days"
              aria-label="Expires after days (empty for never)"
              placeholder="Expires in days (optional)"
              type="number"
              min={1}
              max={365}
              className="w-56"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <Button type="submit" disabled={pending || !name.trim()}>
              Create key
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>Copy these lines now. The key is not shown again.</DialogDescription>
          </DialogHeader>
          <pre className="rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{envLines}</pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(envLines);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent>
          {keys.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No keys yet</EmptyTitle>
                <EmptyDescription>Create one for the surf-roadmap plugin or a script.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Starts with</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name ?? "unnamed"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{k.start ? `${k.start}…` : ""}</TableCell>
                    <TableCell>{k.createdAt.slice(0, 10)}</TableCell>
                    <TableCell>{k.expiresAt ? k.expiresAt.slice(0, 10) : "never"}</TableCell>
                    <TableCell>{k.lastRequest ? k.lastRequest.slice(0, 10) : "never"}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={pending}>
                            Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke {k.name ?? "this key"}?</AlertDialogTitle>
                            <AlertDialogDescription>Anything using it stops working immediately.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await revokeApiKeyAction(k.id);
                                  if (result.ok) toast.success("Key revoked");
                                  else toast.error(result.error);
                                })
                              }
                            >
                              Revoke
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/app/(app)/settings/api-keys/page.tsx`:

```tsx
import { ApiKeyManager } from "@/components/api-key-manager";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/auth/actor";
import { listApiKeys } from "@/lib/ops/api-keys";

/** Page where users create and revoke API keys for MCP and REST. */
export default async function ApiKeysPage() {
  const actor = await requireActor();
  const keys = (await listApiKeys(getDb(), actor)).map((k) => ({
    ...k,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastRequest: k.lastRequest?.toISOString() ?? null,
  }));
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-muted-foreground">
          A key acts as you in every project you belong to. Set the two lines shown after creating a key as environment
          variables for the surf-roadmap plugin.
        </p>
      </div>
      <ApiKeyManager keys={keys} appUrl={process.env.BETTER_AUTH_URL ?? ""} />
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add -A
git commit -m "feat: Add admin accounts page and API key management"
```

---

### Task 2.5: User checkpoint: local environment and Discord credentials

This task needs the user. Do not continue to Part 3 before Step 5 passes.

- [ ] **Step 1: Start the local database**

```bash
docker compose up -d postgres
docker compose ps
```

Expected: `postgres` is `running`. If Docker is not available, stop and ask the user for a `DATABASE_URL` of a Postgres 17 database they control.

- [ ] **Step 2: Create `.env` with everything except the Discord credentials**

```bash
cp .env.example .env
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" .env
grep -v SECRET .env
```

`.env` is ignored by git (`.env*` in `.gitignore`); confirm with `git status --short` that it does not show up.

- [ ] **Step 3: Ask the user for the Discord credentials**

Tell the user, in one message:

> `.env` is ready. Please create a Discord application at https://discord.com/developers/applications, open **OAuth2**, add the redirect `http://localhost:3000/api/auth/callback/discord` (and later `https://<your-host>/api/auth/callback/discord`), then give me the **Client ID** and **Client Secret**, or paste them into `.env` as `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` yourself.

Wait for the answer. Write the values into `.env` if given in chat. Never commit them and never echo the secret back.

- [ ] **Step 4: Start the app**

```bash
npm run dev
```

Expected: the server starts, runs the migrations without errors, and `http://localhost:3000` redirects to `/login`.

- [ ] **Step 5: Manual sign-in check with the user**

Ask the user to:
1. Sign in with Discord → lands on `/` as the first user; the account menu (top right) shows **Admin** and an **Accounts** entry.
2. Open the account menu → **Accounts**, add a second Discord ID (or not), and confirm their own row shows *signed in as …* with **Admin** ticked.
3. Open the account menu → **API keys**, create a key named `test`, see the two env lines once, then revoke it.

Then check the database: `docker compose exec postgres psql -U roadmap -c "select name, is_admin, discord_id from \"user\";"` shows one admin. Record in the progress notes that the checkpoint passed.
