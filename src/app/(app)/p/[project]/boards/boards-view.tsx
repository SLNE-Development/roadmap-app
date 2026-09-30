"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { SquareKanban } from "lucide-react";
import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/**
 * The boards index of a project without boards: an empty state pointing owners
 * to board settings.
 *
 * @param props.slug the project slug
 */
export function BoardsView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const { data: detail } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  const canOwn = detail.role === "owner" || detail.role === "admin";

  return (
    <Page>
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Boards" />
      <EmptyState
        icon={<SquareKanban />}
        title="No boards yet"
        description={
          canOwn ? "Add a board to lay out the systems of this project in columns." : "An owner of this project can add a board."
        }
        action={
          canOwn && (
            <Button asChild>
              <Link href={`/p/${slug}/settings/boards`}>New board</Link>
            </Button>
          )
        }
      />
    </Page>
  );
}
