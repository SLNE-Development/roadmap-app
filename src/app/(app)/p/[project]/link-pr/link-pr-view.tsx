"use client";

import { useMutation, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The picked target: a task id, or null for the whole system. */
type Pick = { taskId: number } | null;

/**
 * The PR link picker: the pull request, what it already links, and a system and task (or the whole system) to add
 * to it as a roadmap ref.
 */
export function LinkPrView({ slug, repoId, number }: { slug: string; repoId: string; number: number }) {
  const t = useTranslations("integrations.linkPr");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const checkId = useId();
  const [{ data: detail }, { data: ctx }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.github.pullRequestContext.queryOptions({ project: slug, repoId, number })],
  });
  const [systemSlug, setSystemSlug] = useState(ctx.systems[0]?.slug ?? "");
  const [pick, setPick] = useState<Pick>(null);
  const [closes, setCloses] = useState(false);
  const system = ctx.systems.find((s) => s.slug === systemSlug);
  const link = useMutation(
    trpc.github.linkPullRequest.mutationOptions({
      onSuccess: async ({ changed, ref }) => {
        toast.success(t(changed ? "added" : "already", { ref }));
        await queryClient.invalidateQueries({ queryKey: trpc.github.pullRequestContext.queryKey({ project: slug, repoId, number }) });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const titles = new Map(ctx.systems.flatMap((s) => s.tasks.map((task) => [task.id, task.title] as const)));
  const state = ctx.pr.merged ? "merged" : ctx.pr.state;
  const chips = [
    ...ctx.linked.tasks.map((id) => ({ key: `t${id}`, label: titles.has(id) ? `roadmap#${id} ${titles.get(id)}` : `roadmap#${id}` })),
    ...ctx.linked.systems.map((s) => ({ key: `s${s}`, label: `roadmap:${s}` })),
  ];

  const submit = () => {
    if (!system) return;
    link.mutate({ project: slug, repoId, number, target: pick ? { taskId: pick.taskId } : { systemSlug: system.slug }, closes: pick ? closes : false });
  };

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title={t("title")} description={t("description")} />
      <Panel bodyClassName="gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <a href={ctx.pr.url} target="_blank" rel="noreferrer" className="min-w-0 font-semibold hover:underline">
            {ctx.repo.fullName}#{ctx.pr.number} {ctx.pr.title}
          </a>
          <span
            className={cn(
              "inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
              state === "merged" ? "bg-cat-done-soft text-cat-done" : state === "open" ? "bg-secondary text-fg-2" : "bg-cat-blocked-soft text-cat-blocked",
            )}
          >
            {t(`state.${state}`)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-fg-2">{t("linkedTitle")}</span>
          {chips.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">{t("linkedNone")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <li key={c.key} className="border bg-muted px-2 py-0.5 font-mono text-[12.5px]">
                  {c.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title={t("target")} bodyClassName="gap-3 p-4 pt-0 sm:p-5 sm:pt-0">
        {ctx.systems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSystems")}</p>
        ) : (
          <>
            <NativeSelect
              aria-label={t("system")}
              value={systemSlug}
              onChange={(e) => {
                setSystemSlug(e.target.value);
                setPick(null);
              }}
            >
              {ctx.systems.map((s) => (
                <NativeSelectOption key={s.slug} value={s.slug}>
                  {s.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Command className="border">
              <CommandInput placeholder={t("search")} />
              <CommandList>
                <CommandEmpty>{t("noMatch")}</CommandEmpty>
                <CommandItem value="whole-system" keywords={[t("wholeSystem")]} data-checked={pick === null} onSelect={() => setPick(null)}>
                  {t("wholeSystem")}
                </CommandItem>
                {system?.tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`${task.id} ${task.title}`}
                    data-checked={pick?.taskId === task.id}
                    onSelect={() => setPick({ taskId: task.id })}
                  >
                    <span className="font-mono text-[12.5px] text-muted-foreground">#{task.id}</span>
                    <span className="min-w-0 truncate">{task.title}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            <div className="flex items-center gap-2">
              <Checkbox id={checkId} checked={pick !== null && closes} disabled={pick === null} onCheckedChange={(v) => setCloses(v === true)} />
              <Label htmlFor={checkId} className={cn(pick === null && "text-muted-foreground")}>
                {t("closes")}
              </Label>
            </div>
            <div>
              <Button type="button" disabled={!system || link.isPending} onClick={submit}>
                {t("submit")}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </Page>
  );
}
