import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { cache } from "react";
import superjson from "superjson";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { sessionActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, OpError, statusOf } from "@/lib/ops/errors";

/** What every procedure sees: the database and the signed-in actor, or `null` without a session. */
export interface Context {
  db: Db;
  actor: Actor | null;
}

/**
 * Builds the context of the current request. Wrapped in `cache` so a server
 * render that prefetches several queries looks up the session once.
 */
export const createContext = cache(async (): Promise<Context> => ({ db: getDb(), actor: await sessionActor() }));

/** The tRPC error code of each op status. */
const CODE_OF: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: "BAD_REQUEST",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

const t = initTRPC.context<Context>().create({ transformer: superjson });

/**
 * Turns what an op throws into a tRPC error carrying the op's status and
 * user-facing message, the same text the server actions used to show.
 * Unexpected failures are logged and read "Something went wrong.".
 */
const opErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const { error } = result;
  const cause = error.cause instanceof OpError || error.cause instanceof ZodError ? error.cause : error.code === "INTERNAL_SERVER_ERROR" ? error.cause : null;
  if (!cause) return result;
  const status = statusOf(cause);
  if (status === 500) console.error(cause);
  throw new TRPCError({ code: CODE_OF[status] ?? "INTERNAL_SERVER_ERROR", message: messageOf(cause), cause });
});

/** Builds routers. */
export const router = t.router;

/** Calls procedures of a router directly, for tests. */
export const createCallerFactory = t.createCallerFactory;

/** A procedure anyone may call, even without a session. */
export const publicProcedure = t.procedure.use(opErrors);

/** A procedure for the signed-in actor; without a session it fails with `UNAUTHORIZED`. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.actor) throw new TRPCError({ code: "UNAUTHORIZED", message: "Your session has ended. Sign in again." });
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});
