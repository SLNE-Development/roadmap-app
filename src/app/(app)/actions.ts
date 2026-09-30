"use server";

import type { z } from "zod";
import { runAction } from "@/app/actions/run";
import { createProject, type createProjectInput } from "@/lib/ops/projects";

/** Creates a project owned by the signed-in user and returns its slug. */
export async function createProjectAction(input: z.input<typeof createProjectInput>) {
  return runAction(async (db, actor) => ({ slug: (await createProject(db, actor, input)).slug }));
}
