import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAdrNumber, listAdrs } from "@/lib/ops/adrs";
import { pageData } from "@/lib/page";

/** The project's decision records by number. */
export default async function AdrsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const adrs = await pageData((db, actor) => listAdrs(db, actor, slug));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="ADRs" title="Decisions" description="Accepted records are immutable; a changed decision is a new ADR that supersedes the old one." />
      {adrs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No ADRs yet</EmptyTitle>
            <EmptyDescription>Agents record decisions you make with surf-roadmap:new-adr.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adrs.map((a) => (
                  <TableRow key={a.number}>
                    <TableCell className="font-mono">{formatAdrNumber(a.number)}</TableCell>
                    <TableCell>
                      <Link href={`/p/${slug}/adrs/${a.number}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === "accepted" ? "default" : a.status === "proposed" ? "outline" : "secondary"}>
                        {a.status}
                        {a.supersededBy ? ` by ${formatAdrNumber(a.supersededBy)}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.systems.join(", ")}</TableCell>
                    <TableCell className="text-muted-foreground">{(a.acceptedAt ?? a.createdAt).toISOString().slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
