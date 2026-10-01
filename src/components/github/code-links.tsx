import Link from "next/link";
import { StatusChip } from "@/components/chips";
import type { ColumnCategory } from "@/db/schema";
import type { CodeLinkView } from "@/lib/ops/github-links";
import { relativeAge } from "@/lib/time";

/** Category colour and label of each link state. */
const STATE_CHIP: Record<CodeLinkView["state"], { category: ColumnCategory; name: string }> = {
  open: { category: "active", name: "Open" },
  merged: { category: "done", name: "Merged" },
  closed: { category: "todo", name: "Closed" },
};

/** The reference of a link as written on GitHub: `#419` for a pull request, the short sha for a commit. */
function linkRef(link: Pick<CodeLinkView, "kind" | "number" | "sha">): string {
  return link.kind === "pr" ? `#${link.number}` : (link.sha ?? "").slice(0, 7);
}

/**
 * The "Code" panel of the system page: the pull requests and commits that mention the system or its tasks.
 *
 * @param props.links the links, newest first
 * @param props.settingsHref where owners link repositories; the empty state offers it when set
 */
export function CodeLinks({ links, settingsHref }: { links: CodeLinkView[]; settingsHref?: string }) {
  const repos = [...new Set(links.map((l) => l.repoFullName))];
  const now = new Date();
  return (
    <section className="flex flex-col border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-4 py-3.5 sm:px-[18px] sm:py-4">
        <h2 className="font-display text-[19px] font-semibold">Code</h2>
        {repos.length > 0 && <span className="ml-auto min-w-0 truncate text-[13px] text-fg-2">{repos.join(", ")}</span>}
      </header>
      {links.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-[13px] text-fg-2 sm:px-[18px]">
          No pull requests or commits mention this system yet. Put roadmap#&lt;task id&gt; in a PR title to link it.
          {settingsHref && (
            <>
              {" "}
              <Link href={settingsHref} className="font-medium text-brand-strong hover:underline">
                GitHub settings
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {links.map((l) => (
            <li key={`${l.repoFullName}-${l.kind}-${l.number ?? l.sha}-${l.taskId ?? "system"}`} className="border-t">
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-[18px]"
              >
                <span className="flex min-w-0 flex-1 basis-56 flex-col">
                  <span className="font-mono text-[13px] break-words">{l.title}</span>
                  <span className="text-xs text-fg-2">
                    {linkRef(l)} · {l.authorName ?? l.authorLogin ?? "unknown"} · {relativeAge(l.updatedAt.toISOString(), now)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusChip {...STATE_CHIP[l.state]} />
                  {l.checks === "pending" && <StatusChip category="review" name="checks running" />}
                  {l.checks === "failure" && <StatusChip category="blocked" name="checks failing" />}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
