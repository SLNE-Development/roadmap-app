import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { QuestionsView } from "./questions-view";

/**
 * The project's questions: Open and Resolved tabs (`?tab=`) with counts, a
 * system filter (`?system=`), and for editors an "Ask a question" dialog and
 * answer forms on the cards.
 */
export default async function QuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "resolved" ? "resolved" : "open";
  const system = typeof sp.system === "string" ? sp.system : undefined;
  await prefetch(
    trpc.questions.list.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
    trpc.projects.get.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <QuestionsView slug={slug} tab={tab} systemSlug={system} />
    </HydrateClient>
  );
}
