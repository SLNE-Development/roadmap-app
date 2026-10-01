import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { PagesView } from "./pages-view";

/** The project's pages: onboarding, conventions, architecture and the like, with their latest version. */
export default async function PagesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.pages.list.queryOptions({ project: slug }), trpc.projects.get.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <PagesView slug={slug} />
    </HydrateClient>
  );
}
