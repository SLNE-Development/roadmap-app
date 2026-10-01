import "server-only";
import { router } from "./init";
import { accountRouter } from "./routers/account";
import { adminRouter } from "./routers/admin";
import { adrsRouter } from "./routers/adrs";
import { agentsRouter } from "./routers/agents";
import { boardsRouter } from "./routers/boards";
import { fieldsRouter } from "./routers/fields";
import { gatesRouter } from "./routers/gates";
import { githubRouter } from "./routers/github";
import { glossaryRouter } from "./routers/glossary";
import { historyRouter } from "./routers/history";
import { insightRouter } from "./routers/insight";
import { membersRouter } from "./routers/members";
import { notificationsRouter } from "./routers/notifications";
import { pagesRouter } from "./routers/pages";
import { planningRouter } from "./routers/planning";
import { presenceRouter } from "./routers/presence";
import { prefsRouter } from "./routers/prefs";
import { projectsRouter } from "./routers/projects";
import { questionsRouter } from "./routers/questions";
import { releasesRouter } from "./routers/releases";
import { requestsRouter } from "./routers/requests";
import { searchRouter } from "./routers/search";
import { structureRouter } from "./routers/structure";
import { systemsRouter } from "./routers/systems";
import { tasksRouter } from "./routers/tasks";
import { viewsRouter } from "./routers/views";
import { webhooksRouter } from "./routers/webhooks";

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
  glossary: glossaryRouter,
  gates: gatesRouter,
  pages: pagesRouter,
  search: searchRouter,
  agents: agentsRouter,
  admin: adminRouter,
  notifications: notificationsRouter,
  webhooks: webhooksRouter,
  github: githubRouter,
  insight: insightRouter,
  releases: releasesRouter,
  presence: presenceRouter,
  requests: requestsRouter,
});

/** The router's type, the only thing the client imports from the server. */
export type AppRouter = typeof appRouter;
