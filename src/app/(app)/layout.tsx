import { requireActor } from "@/lib/auth/actor";

/** Every signed-in page reads live data. */
export const dynamic = "force-dynamic";

/**
 * Gate of every signed-in page: checks the session. The `(global)` and project
 * layouts below render the shell with the sidebar that fits them.
 *
 * @param props.children the page content
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireActor();
  return children;
}
