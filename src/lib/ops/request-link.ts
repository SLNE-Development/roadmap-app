import { eq } from "drizzle-orm";
import { eventRequest } from "@/db/schema";
import type { Executor } from "@/db/types";
import { InvalidError } from "./errors";

/** The spec version a request's system was written against, and the brief version it was based on. */
export interface SpecBasis {
  specVersion: number;
  briefVersion: number;
}

/** Returns the basis of the request's spec; always null until Task 7 adds the `event_spec_basis` table. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getSpecBasis(db: Executor, requestId: string): Promise<SpecBasis | null> {
  return null;
}

/**
 * Checks that the system belongs to a request and that `briefVersion` exists, so `write_spec` can record its basis.
 *
 * @returns the request id
 * @throws InvalidError when no request is linked to the system or the brief version does not exist
 */
export async function requestOfSystem(db: Executor, systemId: string, briefVersion: number): Promise<string> {
  const [request] = await db.select({ id: eventRequest.id, current: eventRequest.briefVersion }).from(eventRequest).where(eq(eventRequest.systemId, systemId)).limit(1);
  if (!request) throw new InvalidError("This system has no request.");
  if (briefVersion > request.current) throw new InvalidError(`The request has no brief version ${briefVersion}.`);
  return request.id;
}

/** Records that the spec at `specVersion` is based on `briefVersion`; Task 7 stores it, until then this does nothing. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function recordSpecBasis(db: Executor, requestId: string, specVersion: number, briefVersion: number): Promise<void> {}
