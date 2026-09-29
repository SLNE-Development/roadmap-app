import Link from "next/link";
import type { Actor } from "@/lib/ops/actor";
import { UserMenu } from "./user-menu";

/** Top bar: app name, project navigation passed as `children`, and the account menu. */
export function Nav({ actor, children }: { actor: Actor; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="font-semibold">
          Roadmap
        </Link>
        {children}
        <div className="ml-auto">
          <UserMenu name={actor.name} isAdmin={actor.isAdmin} />
        </div>
      </div>
    </header>
  );
}
