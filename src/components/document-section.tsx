import { FileText } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/page";
import type { DocumentView } from "@/lib/ops/documents";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { AuthorText } from "./system/author";
import { VersionPicker } from "./version-picker";

/** Above this many characters, the overview's spec preview is clipped with a fade. */
const PREVIEW_CHARS = 900;

/** "v2 · Aiko Tanaka via claude-code · 12 Sep" for a document version. */
function DocumentMeta({ doc }: { doc: DocumentView }) {
  return (
    <span className="text-[12.5px] text-muted-foreground">
      v{doc.version} · <AuthorText label={doc.author} /> · {formatDate(doc.createdAt.toISOString())}
    </span>
  );
}

/**
 * A spec or plan in full, as on its tab: the chosen version rendered, its
 * author and date, and a version picker when there are older versions.
 *
 * @param props.param the search parameter that selects the version
 * @param props.empty the empty state's title and sentence
 */
export function DocumentSection({
  title,
  doc,
  param,
  empty,
}: {
  title: string;
  doc: DocumentView | null;
  param: string;
  empty: { title: string; description: string };
}) {
  if (!doc) return <EmptyState icon={<FileText />} title={empty.title} description={empty.description} />;
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3.5 sm:px-6">
        <h2 className="font-display text-[19px] font-semibold">{title}</h2>
        <DocumentMeta doc={doc} />
        {doc.versions.length > 1 && (
          <div className="ml-auto flex items-center gap-3">
            {doc.version !== doc.versions[0] && (
              <span className="text-[12.5px] text-cat-review">An older version. The latest is v{doc.versions[0]}.</span>
            )}
            <VersionPicker param={param} versions={doc.versions} current={doc.version} />
          </div>
        )}
      </header>
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <Markdown>{doc.body}</Markdown>
      </div>
    </section>
  );
}

/**
 * The overview's Specification panel: the latest spec, clipped when long,
 * with its version, author and date and a link to the full spec tab.
 */
export function SpecPreview({ doc, href }: { doc: DocumentView | null; href: string }) {
  const long = doc !== null && doc.body.length > PREVIEW_CHARS;
  return (
    <section className="flex flex-col gap-3 border bg-card px-4 py-4 sm:px-[22px] sm:py-[18px]">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="font-display text-[19px] font-semibold">Specification</h2>
        {doc && <DocumentMeta doc={doc} />}
      </header>
      {doc ? (
        <>
          <div className={cn("relative", long && "max-h-[340px] overflow-hidden")}>
            <Markdown className="text-fg-2 [&_h1,&_h2,&_h3,&_h4,&_strong]:text-foreground">{doc.body}</Markdown>
            {long && <div aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card to-transparent" />}
          </div>
          <Link href={href} className="self-start text-[13px] font-semibold text-brand-strong hover:underline">
            Read the full spec
          </Link>
        </>
      ) : (
        <p className="text-[13px] text-fg-2">No spec yet. It is written at the end of the planning interview.</p>
      )}
    </section>
  );
}
