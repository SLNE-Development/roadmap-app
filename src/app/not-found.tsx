import Link from "next/link";
import { NotFoundScreen } from "@/components/status-screens";
import { Button } from "@/components/ui/button";

/** The 404 for addresses that match no page. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col justify-center">
      <p className="px-4 font-display text-lg font-semibold sm:px-6 lg:px-9">Roadmap</p>
      <NotFoundScreen
        title="Page not found"
        text="The address doesn't match any page."
        action={
          <Button asChild>
            <Link href="/">Go to your projects</Link>
          </Button>
        }
      />
    </main>
  );
}
