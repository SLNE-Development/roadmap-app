import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SettingsFrame } from "./settings-frame";

/**
 * Frame of the project settings pages: the header and a sub-navigation beside
 * the page content (above it on phones).
 *
 * @param props.params the route parameters with the project slug
 */
export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.members.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <SettingsFrame slug={slug}>{children}</SettingsFrame>
    </HydrateClient>
  );
}
