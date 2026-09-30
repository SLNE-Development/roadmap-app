import { z } from "zod";

/** A slug as routes carry it; unknown slugs fail as not found in the op, not as invalid input. */
const ref = z.string().min(1).max(64);

/** The project a procedure acts in. */
export const P = { project: ref };

/** The project and system a procedure acts on. */
export const S = { project: ref, system: ref };

/** The project and board a procedure acts on. */
export const B = { project: ref, board: ref };
