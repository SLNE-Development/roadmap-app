import "server-only";
import { router } from "./init";
import { accountRouter } from "./routers/account";
import { adrsRouter } from "./routers/adrs";
import { boardsRouter } from "./routers/boards";
import { fieldsRouter } from "./routers/fields";
import { gatesRouter } from "./routers/gates";
import { historyRouter } from "./routers/history";
import { membersRouter } from "./routers/members";
import { planningRouter } from "./routers/planning";
import { prefsRouter } from "./routers/prefs";
import { projectsRouter } from "./routers/projects";
import { questionsRouter } from "./routers/questions";
import { structureRouter } from "./routers/structure";
import { systemsRouter } from "./routers/systems";
import { tasksRouter } from "./routers/tasks";
import { viewsRouter } from "./routers/views";

/**
 * The web UI's API: one router per area, each procedure a thin call into
 * `lib/ops` as the signed-in actor. REST and MCP keep their own tool registry.
 */
export const appRouter = router({
  account: accountRouter,
  projects: projectsRouter,
  members: membersRouter,
  boards: boardsRouter,
  structure: structureRouter,
  fields: fieldsRouter,
  systems: systemsRouter,
  tasks: tasksRouter,
  questions: questionsRouter,
  adrs: adrsRouter,
  planning: planningRouter,
  history: historyRouter,
  prefs: prefsRouter,
  views: viewsRouter,
  gates: gatesRouter,
});

/** The router's type, the only thing the client imports from the server. */
export type AppRouter = typeof appRouter;
