import { Nav } from "@/components/nav";
import { requireActor } from "@/lib/auth/actor";

/** Every signed-in page reads live data. */
export const dynamic = "force-dynamic";

/**
 * Shell for every signed-in page: checks the session, then renders the navigation; each page sets its own width.
 *
 * @param props.children the page content
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <>
      <Nav actor={actor} />
      <main className="px-4">{children}</main>
    </>
  );
}
