"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColumnCategory } from "@/db/schema";
import type { ColumnRuleRow } from "@/lib/ops/gates";
import { useTRPC } from "@/trpc/client";

/** The `settings.rules.names` key of each gate rule id; a rule without an entry shows the label the server sent. */
const RULE_NAMES = {
  "all-tasks-done": "allTasksDone",
  "no-open-questions": "noOpenQuestions",
  "spec-exists": "specExists",
  "plan-covers-tasks": "planCoversTasks",
  "update-within-days": "updateWithinDays",
  "adr-linked": "adrLinked",
  "pr-open": "prOpen",
  "pr-merged": "prMerged",
} as const;

/** A saved column as the rules dialog needs it. */
export interface RuleColumn {
  id: string;
  name: string;
  category: ColumnCategory;
  rules: ColumnRuleRow[];
}

/**
 * The "Rules (n)" button of a saved column and the dialog it opens: one checkbox per
 * entry rule, with a number field for rules that take a parameter. The planning column
 * shows a disabled button, since the planning interview is its gate. Without `canEdit`
 * the rules are read-only.
 */
export function ColumnRulesDialog({ projectSlug, boardSlug, column, canEdit }: { projectSlug: string; boardSlug: string; column: RuleColumn; canEdit: boolean }) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const label = t("rules.button", { count: column.rules.length });
  if (column.category === "planning") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button variant="outline" size="sm" disabled aria-label={t("rules.buttonOf", { label, name: column.name })}>
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("rules.planningGate")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("rules.buttonOf", { label, name: column.name })}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* Mounted only while open, so it starts from the saved rules each time. */}
        {open && <RulesForm projectSlug={projectSlug} boardSlug={boardSlug} column={column} canEdit={canEdit} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** The form of {@link ColumnRulesDialog}. */
function RulesForm({
  projectSlug,
  boardSlug,
  column,
  canEdit,
  onDone,
}: {
  projectSlug: string;
  boardSlug: string;
  column: RuleColumn;
  canEdit: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const { data: rules } = useQuery(trpc.gates.rules.queryOptions({ project: projectSlug, include: column.rules.map((r) => r.rule) }));
  const save = useMutation(trpc.boards.setColumnRules.mutationOptions({ onSuccess: () => (toast.success(t("rules.saved")), onDone()) }));
  // Chosen rules by id; the value is the parameter, null for rules without one.
  /** The translated name of a rule, with the day count for the rule that takes one. */
  const nameOf = (rule: { id: string; label: string }, param: number | null) =>
    rule.id === "update-within-days" && (param ?? 3) === 1
      ? t("rules.names.updateWithinDay")
      : rule.id in RULE_NAMES
        ? t(`rules.names.${RULE_NAMES[rule.id as keyof typeof RULE_NAMES]}`, { days: param ?? 3 })
        : rule.label;
  const [chosen, setChosen] = useState(() => new Map<string, number | null>(column.rules.map((r) => [r.rule, r.param])));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("rules.title", { name: column.name })}</DialogTitle>
        <DialogDescription>
          {canEdit ? t("rules.descriptionEdit") : t("rules.descriptionRead")}
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-2.5">
        {(rules ?? []).map((rule) => {
          const on = chosen.has(rule.id);
          const param = chosen.get(rule.id) ?? rule.param?.default ?? null;
          return (
            <li key={rule.id} className="flex flex-wrap items-center gap-2.5">
              <Checkbox
                id={`rule-${rule.id}`}
                checked={on}
                disabled={!canEdit}
                onCheckedChange={(checked) =>
                  setChosen((prev) => {
                    const next = new Map(prev);
                    if (checked) next.set(rule.id, rule.param?.default ?? null);
                    else next.delete(rule.id);
                    return next;
                  })
                }
              />
              <label htmlFor={`rule-${rule.id}`} className="flex-1 text-[13.5px]">
                {nameOf(rule, null)}
                {rule.note && <span className="ml-2 text-xs text-muted-foreground">{rule.id.startsWith("pr-") ? t("rules.githubNote") : rule.note}</span>}
              </label>
              {rule.param && on && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Input
                    type="number"
                    aria-label={t("rules.paramLabel", { label: nameOf(rule, param), unit: rule.param.unit === "days" ? t("rules.unitDays") : rule.param.unit })}
                    min={rule.param.min}
                    max={rule.param.max}
                    value={param ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => setChosen((prev) => new Map(prev).set(rule.id, e.target.value === "" ? null : Number(e.target.value)))}
                    className="h-[30px] w-20 px-2"
                  />
                  {rule.param.unit === "days" ? t("rules.unitDays") : rule.param.unit}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <DialogFooter>
          <Button
            disabled={save.isPending || !rules}
            onClick={() =>
              save.mutate({
                project: projectSlug,
                board: boardSlug,
                column: column.id,
                rules: [
                  ...(rules ?? []).filter((r) => chosen.has(r.id)).map((r) => r.id),
                  // A chosen rule missing from the list (stale or hidden) is kept, not dropped.
                  ...[...chosen.keys()].filter((id) => !(rules ?? []).some((r) => r.id === id)),
                ].map((id) => ({ rule: id, param: chosen.get(id) ?? null })),
              })
            }
          >
            {t("rules.save")}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}
