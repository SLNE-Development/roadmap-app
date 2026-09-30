import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocumentView } from "@/lib/ops/documents";
import { Markdown } from "./markdown";
import { VersionPicker } from "./version-picker";

/** A spec or plan card: the chosen version rendered, with its author and a version picker. */
export function DocumentSection({ title, doc, param, empty }: { title: string; doc: DocumentView | null; param: string; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {doc && (
          <CardDescription>
            v{doc.version} by {doc.author}, {doc.createdAt.toISOString().slice(0, 10)}
          </CardDescription>
        )}
        {doc && doc.versions.length > 1 && (
          <CardAction>
            <VersionPicker param={param} versions={doc.versions} current={doc.version} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{doc ? <Markdown>{doc.body}</Markdown> : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  );
}
