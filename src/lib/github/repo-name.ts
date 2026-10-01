import { z } from "zod";

/** A repository name as GitHub spells it: `owner/repo`. Shared by the ops and the manual link form. */
export const repoFullNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "Use owner/repo, such as octo-org/roadmap.");
