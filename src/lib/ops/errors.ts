import { ZodError } from "zod";

/** An expected failure of an operation, carrying the HTTP status adapters respond with. */
export class OpError extends Error {
  /**
   * @param message the user-facing message
   * @param status the HTTP status for this failure
   */
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The input is well-formed but not acceptable, such as an unknown column name. */
export class InvalidError extends OpError {
  /** @param message the user-facing message */
  constructor(message: string) {
    super(message, 400);
  }
}

/** The actor can see the project but their role does not allow the operation. */
export class ForbiddenError extends OpError {
  /** @param message the user-facing message */
  constructor(message: string) {
    super(message, 403);
  }
}

/** The entity does not exist or lies in a project the actor cannot see. */
export class NotFoundError extends OpError {
  /** @param message the user-facing message */
  constructor(message: string) {
    super(message, 404);
  }
}

/** The operation conflicts with the current state: a gate, an invariant or a uniqueness rule. */
export class ConflictError extends OpError {
  /** @param message the user-facing message */
  constructor(message: string) {
    super(message, 409);
  }
}

/** Returns whether `error`, or an error in its `cause` chain, is a Postgres unique violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Returns the HTTP status for an error: the op status, 400 for zod errors, 500 for anything else. */
export function statusOf(error: unknown): number {
  if (error instanceof OpError) return error.status;
  if (error instanceof ZodError) return 400;
  return 500;
}

/**
 * Returns the message to show for an error: the op message, zod issues as
 * `path: message` joined by `; `, or a generic text that leaks nothing.
 */
export function messageOf(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  }
  if (error instanceof OpError) return error.message;
  return "Something went wrong.";
}
