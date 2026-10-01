"use client";

import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthorText } from "@/components/system/author";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/slug";
import { useShortDate } from "@/lib/use-short-date";
import { useTRPC } from "@/trpc/client";

/**
 * Button and dialog creating a page, then opening it. The page starts with its title as a heading;
 * the slug follows the title until it is edited by hand.
 */
function NewPageDialog({ projectSlug, trigger }: { projectSlug: string; trigger?: React.ReactNode }) {
  const t = useTranslations("pages.new");
  const tc = useTranslations("common");
  const router = useRouter();
  const trpc = useTRPC();
  const create = useMutation(
    trpc.pages.write.mutationOptions({
      onSuccess: (_result, { page, title }) => {
        setOpen(false);
        toast.success(t("created", { title: title?.trim() ?? "" }));
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
            {t("button")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ project: projectSlug, page: slug, title, body: `# ${title.trim()}`, create: true });
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="page-title">{t("titleLabel")}</FieldLabel>
              <Input
                id="page-title"
                value={title}
                autoFocus
                maxLength={120}
                placeholder={t("titlePlaceholder")}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="page-slug">{t("slugLabel")}</FieldLabel>
              <Input
                id="page-slug"
                className="font-mono"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
              />
              <FieldDescription>{t("slugHelp")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || !title.trim() || !slug.trim()}>
              {t("submit")}
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
  const t = useTranslations("pages");
  const shortDate = useShortDate();
  const trpc = useTRPC();
  const [{ data: pages }, { data: detail }] = useSuspenseQueries({
    queries: [trpc.pages.list.queryOptions({ project: slug }), trpc.projects.get.queryOptions({ project: slug })],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title={t("title")}
        description={t("description")}
        actions={canEdit && pages.length > 0 ? <NewPageDialog projectSlug={slug} /> : undefined}
      />
      {pages.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={canEdit ? <NewPageDialog projectSlug={slug} /> : undefined}
        />
      ) : (
        <ul className="flex flex-col border bg-card">
          {pages.map((p) => (
            <li key={p.slug} className="border-b last:border-b-0">
              <Link href={`/p/${slug}/pages/${p.slug}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-accent/40 sm:px-6">
                <span className="font-display text-[16px] font-semibold">{p.title}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {t("version", { version: p.version })} · <AuthorText name={p.authorName} agent={p.agent} /> · {shortDate(p.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
