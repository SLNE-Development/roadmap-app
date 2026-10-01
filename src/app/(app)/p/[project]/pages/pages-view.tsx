"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuthorText } from "@/components/system/author";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { formatDate } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog creating a page, then opening it. The page starts with its title as a heading;
 * the slug follows the title until it is edited by hand.
 */
function NewPageDialog({ projectSlug, trigger }: { projectSlug: string; trigger?: React.ReactNode }) {
  const router = useRouter();
  const trpc = useTRPC();
  const create = useMutation(
    trpc.pages.write.mutationOptions({
      onSuccess: (_result, { page, title }) => {
        setOpen(false);
        toast.success(`Created ${title?.trim()}`);
        router.push(`/p/${projectSlug}/pages/${page}`);
      },
    }),
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden />
            New page
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ project: projectSlug, page: slug, title, body: `# ${title.trim()}` });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">New page</DialogTitle>
            <DialogDescription>It starts with its title as a heading. Write the rest after it opens.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="page-title">Title</FieldLabel>
              <Input
                id="page-title"
                value={title}
                autoFocus
                maxLength={120}
                placeholder="Onboarding"
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="page-slug">Slug</FieldLabel>
              <Input
                id="page-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
              />
              <FieldDescription>Agents refer to the page by this.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !title.trim() || !slug.trim()}>
              Create page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The pages list: each page's title and latest version, author and date, or an empty state.
 * Editors get a "New page" button.
 *
 * @param props.slug the project slug
 */
export function PagesView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [{ data: pages }, { data: detail }] = useSuspenseQueries({
    queries: [trpc.pages.list.queryOptions({ project: slug }), trpc.projects.get.queryOptions({ project: slug })],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title="Pages"
        description="What isn't tied to one system: onboarding, conventions, architecture."
        actions={canEdit && pages.length > 0 ? <NewPageDialog projectSlug={slug} /> : undefined}
      />
      {pages.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="No pages yet"
          description="Pages hold what isn't tied to one system: onboarding, conventions, architecture."
          action={canEdit ? <NewPageDialog projectSlug={slug} /> : undefined}
        />
      ) : (
        <ul className="flex flex-col border bg-card">
          {pages.map((p) => (
            <li key={p.slug} className="border-b last:border-b-0">
              <Link href={`/p/${slug}/pages/${p.slug}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-accent/40 sm:px-6">
                <span className="font-display text-[16px] font-semibold">{p.title}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  v{p.version} · <AuthorText name={p.authorName} agent={p.agent} /> · {formatDate(p.updatedAt.toISOString())}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
