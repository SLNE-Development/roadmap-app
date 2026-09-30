import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/actor";

/** Every signed-in page reads live data. */
export const dynamic = "force-dynamic";

/** Signed-in pages are private: search engines never see them, and they stay out of the index even if a link leaks. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
