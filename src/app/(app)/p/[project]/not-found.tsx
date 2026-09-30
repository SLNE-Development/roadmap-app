"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { NotFoundScreen } from "@/components/status-screens";
import { Button } from "@/components/ui/button";

/** The link back to the overview; `not-found.tsx` gets no params, so it reads the slug itself. */
function OverviewLink() {
  const { project } = useParams<{ project: string }>();
  return (
    <Button asChild>
      <Link href={`/p/${project}`}>Back to the overview</Link>
    </Button>
  );
}

/** Shown inside the project shell when a system, board or decision does not exist. */
export default function ProjectNotFound() {
  return (
    <NotFoundScreen
      title="Not found"
      text="This system, board or decision doesn't exist in this project, or it was renamed or deleted."
      action={<OverviewLink />}
    />
  );
}
