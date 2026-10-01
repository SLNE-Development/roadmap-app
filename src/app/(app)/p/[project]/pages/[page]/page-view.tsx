"use client";

import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { DocumentDiff } from "@/components/document-diff";
import { DocumentSection } from "@/components/document-section";
import { Page, PageHeader } from "@/components/page";
import { PageEditor } from "@/components/pages/page-editor";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/** The differences between two versions of the page, in place of its body. */
function ComparedPage({ projectSlug, pageSlug, from, to, glossary }: { projectSlug: string; pageSlug: string; from: number; to: number; glossary: React.ComponentProps<typeof DocumentSection>["glossary"] }) {
  const trpc = useTRPC();
  const { data: c } = useSuspenseQuery(trpc.pages.compare.queryOptions({ project: projectSlug, page: pageSlug, from, to }));
  return (
    <DocumentSection
      title="Contents"
      doc={c.to}
      param="v"
      glossary={glossary}
      empty={{ title: "No such version", description: "" }}
      compare={{ from, to, diff: <DocumentDiff hunks={c.hunks} added={c.added} removed={c.removed} from={from} to={to} /> }}
    />
  );
}

/**
 * A project page: the chosen version (or the diff of two) with the outline, glossary terms and
 * version picker. Editors can open the editor on the latest version.
 *
 * @param props.version the version from `?v=`; the latest when undefined
 * @param props.compare the versions from `?compare=`, shown instead of the body when set
 */
export function PageView({ projectSlug, pageSlug, version, compare }: { projectSlug: string; pageSlug: string; version: number | undefined; compare: { from: number; to: number } | undefined }) {
  const trpc = useTRPC();
  const [{ data: doc }, { data: detail }, { data: glossary }] = useSuspenseQueries({
    queries: [
      trpc.pages.get.queryOptions({ project: projectSlug, page: pageSlug, version }),
      trpc.projects.get.queryOptions({ project: projectSlug }),
      trpc.glossary.list.queryOptions({ project: projectSlug }),
    ],
  });
  const [editing, setEditing] = useState(false);
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  const isLatest = doc.version === doc.versions[0];
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[
          { label: detail.project.name, href: `/p/${projectSlug}` },
          { label: "Pages", href: `/p/${projectSlug}/pages` },
          { label: doc.title },
        ]}
        title={doc.title}
        actions={
          canEdit && isLatest && !compare && !editing ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              Edit
            </Button>
          ) : undefined
        }
      />
      {editing ? (
        <PageEditor projectSlug={projectSlug} page={doc} onClose={() => setEditing(false)} />
      ) : compare ? (
        <ComparedPage projectSlug={projectSlug} pageSlug={pageSlug} glossary={glossary} {...compare} />
      ) : (
        <DocumentSection title="Contents" doc={doc} param="v" glossary={glossary} empty={{ title: "Empty page", description: "" }} />
      )}
    </Page>
  );
}
