import Link from "next/link";
import { notFound } from "next/navigation";
import { AcceptAdrButton } from "@/components/accept-adr-button";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAdrNumber, getAdr } from "@/lib/ops/adrs";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** One ADR with its four sections and its supersede links. */
export default async function AdrPage({ params }: { params: Promise<{ project: string; number: string }> }) {
  const { project: slug, number: raw } = await params;
  const number = Number(raw);
  if (!/^[0-9]{1,9}$/.test(raw) || number < 1) notFound();
  const { adr, role } = await pageData(async (db, actor) => ({ adr: await getAdr(db, actor, slug, number), role: (await getProject(db, actor, slug)).role }));
  const sections = [
    ["Context", adr.context],
    ["Decision", adr.decision],
    ["Alternatives considered", adr.alternatives],
    ["Consequences", adr.consequences],
  ] as const;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        eyebrow={`ADR ${formatAdrNumber(adr.number)}`}
        title={adr.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{adr.status}</Badge>
            {adr.author} · {adr.createdAt.toISOString().slice(0, 10)}
            {adr.supersedes && (
              <Link href={`/p/${slug}/adrs/${adr.supersedes}`} className="underline">
                supersedes {formatAdrNumber(adr.supersedes)}
              </Link>
            )}
            {adr.supersededBy && (
              <Link href={`/p/${slug}/adrs/${adr.supersededBy}`} className="underline">
                superseded by {formatAdrNumber(adr.supersededBy)}
              </Link>
            )}
            {adr.systems.map((s) => (
              <Link key={s} href={`/p/${slug}/systems/${s}`} className="underline">
                {s}
              </Link>
            ))}
          </span>
        }
        actions={adr.status === "proposed" && role !== "viewer" && <AcceptAdrButton projectSlug={slug} number={adr.number} />}
      />
      {sections.map(([title, body]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown>{body}</Markdown>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
