"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DirtyBar } from "@/components/events/dirty-bar";
import { EmptyState, Panel } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerValueSchema } from "@/lib/event-questions";
import type { QuestionView, RoundView } from "@/lib/ops/request-questions";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** What the requester has put into one question so far; `value` is undefined while nothing is chosen. */
interface Draft {
  value: unknown;
  notSure: boolean;
  /** Changed by the person since the card loaded. */
  touched: boolean;
  /** Pre-selected from the team's suggestion and not yet stored. */
  suggested: boolean;
}

/** Returns the question's fields as the schema builder wants them. */
const specOf = (q: QuestionView) => ({ type: q.type, options: q.options, other: q.other, min: q.min, max: q.max });

/** Returns how many questions of the rounds are still unanswered ("not sure" counts as answered). */
export function openCount(rounds: RoundView[]): number {
  return rounds.reduce((n, r) => n + r.questions.filter((q) => q.answeredAt === null).length, 0);
}

/** The class of a native radio or checkbox. */
const NATIVE = "size-4 shrink-0 accent-primary";

/** One segment of a segmented control: a native radio inside a label, so the keyboard works as for any radio group. */
function Segment({ name, checked, disabled, label, onSelect }: { name: string; checked: boolean; disabled?: boolean; label: string; onSelect: () => void }) {
  return (
    <label
      className={cn(
        "flex min-w-10 cursor-pointer items-center justify-center border px-3 py-1.5 text-[13px] select-none has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} disabled={disabled} onChange={onSelect} />
      {label}
    </label>
  );
}

/** The input of one question, by type. `labelId` names the question for assistive technology. */
function Control({ q, labelId, value, disabled, onChange }: { q: QuestionView; labelId: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const t = useTranslations("events.questions");
  const name = useId();
  const obj = (value ?? {}) as { option?: string; other?: string; options?: string[] };
  switch (q.type) {
    case "text":
      return <Textarea aria-labelledby={labelId} value={typeof value === "string" ? value : ""} maxLength={2000} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "choice": {
      const otherOn = typeof obj.other === "string";
      return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 text-[13.5px]">
              <input type="radio" name={name} className={NATIVE} checked={obj.option === o} disabled={disabled} onChange={() => onChange({ option: o })} />
              {o}
            </label>
          ))}
          {q.other && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="radio" name={name} className={NATIVE} checked={otherOn} disabled={disabled} onChange={() => onChange({ other: "" })} />
                {t("other")}
              </label>
              {otherOn && <Input aria-label={t("otherAnswer")} className="max-w-xs" value={obj.other} maxLength={500} disabled={disabled} onChange={(e) => onChange({ other: e.target.value })} />}
            </div>
          )}
        </div>
      );
    }
    case "multi": {
      const picked = obj.options ?? [];
      const other = typeof obj.other === "string" ? obj.other : "";
      const emit = (options: string[], text: string) => onChange({ options, ...(text.trim() ? { other: text } : {}) });
      return (
        <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                className={NATIVE}
                checked={picked.includes(o)}
                disabled={disabled}
                onChange={(e) => emit(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o), other)}
              />
              {o}
            </label>
          ))}
          {q.other && <Input aria-label={t("otherAnswer")} placeholder={t("other")} className="max-w-xs" value={other} maxLength={500} disabled={disabled} onChange={(e) => emit(picked, e.target.value)} />}
        </div>
      );
    }
    case "number":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step="any"
            min={q.min}
            max={q.max}
            aria-labelledby={labelId}
            className="max-w-40"
            value={typeof value === "number" ? String(value) : ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === "" || Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)}
          />
          {q.unit && <span className="text-[13px] text-fg-2">{q.unit}</span>}
        </div>
      );
    case "date":
    case "time":
      return <Input type={q.type} aria-labelledby={labelId} className="max-w-48" value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} />;
    case "yesno":
      return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex">
          <Segment name={name} checked={value === true} disabled={disabled} label={t("yes")} onSelect={() => onChange(true)} />
          <Segment name={name} checked={value === false} disabled={disabled} label={t("no")} onSelect={() => onChange(false)} />
        </div>
      );
    case "scale": {
      const max = q.max ?? 5;
      return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <Segment key={n} name={name} checked={value === n} disabled={disabled} label={String(n)} onSelect={() => onChange(n)} />
          ))}
        </div>
      );
    }
  }
}

/** An answer as a sentence-free value for the read-only view. */
function AnswerValue({ q }: { q: QuestionView }) {
  const t = useTranslations("events.questions");
  const a = q.answer as { option?: string; other?: string; options?: string[] } | string | number | boolean;
  if (q.type === "choice") return <>{typeof a === "object" ? (a.option ?? a.other) : null}</>;
  if (q.type === "multi" && typeof a === "object") return <>{[...(a.options ?? []), ...(a.other ? [a.other] : [])].join(", ")}</>;
  if (q.type === "yesno") return <>{a === true ? t("yes") : t("no")}</>;
  if (q.type === "number") return <>{q.unit ? `${a} ${q.unit}` : String(a)}</>;
  if (q.type === "scale") return <>{t("scaleValue", { value: Number(a), max: q.max ?? 5 })}</>;
  return <>{String(a)}</>;
}

/** One round: editable by the requester, read-only for the team, with the answers once given. */
function RoundCard({ requestId, round, canAnswer }: { requestId: string; round: RoundView; canAnswer: boolean }) {
  const t = useTranslations("events.questions");
  const format = useFormatter();
  const trpc = useTRPC();
  const initialDrafts = () => {
    const start: Record<string, Draft> = {};
    for (const q of round.questions) {
      if (q.answeredAt) start[q.id] = { value: q.answer ?? undefined, notSure: q.notSure, touched: false, suggested: false };
      else if (q.suggested !== null && q.suggested !== undefined) start[q.id] = { value: q.suggested, notSure: false, touched: false, suggested: true };
    }
    return start;
  };
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initialDrafts);
  /** The hint under a multi-select question about how many to pick. */
  const hintOf = (q: QuestionView): string | null => {
    if (q.type !== "multi") return null;
    if (q.min !== undefined && q.max !== undefined) return t("pickBetween", { min: q.min, max: q.max });
    if (q.min !== undefined && q.min > 0) return t("pickAtLeast", { min: q.min });
    if (q.max !== undefined) return t("pickUpTo", { max: q.max });
    return null;
  };
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const save = useMutation(
    trpc.requests.answerQuestions.mutationOptions({
      // What was sent is now stored; answers typed while the save ran stay unsaved.
      onSuccess: (_result, vars) => {
        const sent = new Set(vars.answers.map((a) => a.questionId));
        setDrafts((d) => Object.fromEntries(Object.entries(d).map(([id, draft]) => [id, sent.has(id) ? { ...draft, touched: false, suggested: false } : draft])));
        toast.success(t("saved"));
      },
    }),
  );
  const set = (q: QuestionView, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [q.id]: { ...(d[q.id] ?? { value: undefined, notSure: false }), suggested: false, touched: true, ...patch } }));
    setInvalid((s) => new Set([...s].filter((id) => id !== q.id)));
  };
  const pending = round.questions.filter((q) => {
    const d = drafts[q.id];
    return d && (d.touched || d.suggested) && (d.notSure || d.value !== undefined);
  });
  const submit = () => {
    const bad = pending.filter((q) => !drafts[q.id].notSure && !answerValueSchema(specOf(q)).safeParse(drafts[q.id].value).success);
    setInvalid(new Set(bad.map((q) => q.id)));
    if (bad.length > 0) return;
    save.mutate({ id: requestId, answers: pending.map((q) => (drafts[q.id].notSure ? { questionId: q.id, notSure: true } : { questionId: q.id, value: drafts[q.id].value })) });
  };
  return (
    <Panel
      title={t("round", { number: round.number })}
      meta={t("askedBy", { name: round.author, date: format.dateTime(round.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
      bodyClassName="pb-0"
    >
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        {round.questions.map((q) => {
          const draft = drafts[q.id] ?? (q.answeredAt ? { value: q.answer ?? undefined, notSure: q.notSure, touched: false, suggested: false } : undefined);
          const labelId = `q-${q.id}`;
          const hint = hintOf(q);
          return (
            <div key={q.id} className="flex flex-col gap-2 border bg-background p-4">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p id={labelId} className="font-semibold">
                  {q.text}
                </p>
                <span className="text-xs text-muted-foreground">{q.required ? t("required") : t("optional")}</span>
                {q.notSure && <Badge variant="secondary">{t("notSureBadge")}</Badge>}
                {draft?.suggested && <Badge variant="outline">{t("suggested")}</Badge>}
              </div>
              {q.why && <p className="text-[13px] text-fg-2">{q.why}</p>}
              {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
              {canAnswer ? (
                <>
                  <Control q={q} labelId={labelId} value={draft?.notSure ? undefined : draft?.value} disabled={false} onChange={(value) => set(q, { value, notSure: false })} />
                  <div>
                    <Button type="button" size="xs" variant={draft?.notSure ? "default" : "outline"} aria-pressed={draft?.notSure === true} onClick={() => set(q, { value: undefined, notSure: !draft?.notSure })}>
                      {t("notSure")}
                    </Button>
                  </div>
                  {invalid.has(q.id) && (
                    <p role="alert" className="text-[13px] text-destructive">
                      {t("invalid")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13.5px]">
                  {q.answeredAt === null ? <span className="text-muted-foreground">{t("unanswered")}</span> : q.notSure ? <span className="text-fg-2">{t("notSureAnswer")}</span> : <AnswerValue q={q} />}
                </p>
              )}
              {q.answeredAt && (
                <p className="text-xs text-muted-foreground">{t("answeredBy", { name: q.answeredByName ?? "", date: format.dateTime(q.answeredAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
              )}
            </div>
          );
        })}
      </div>
      {canAnswer && (
        <DirtyBar
          dirty={pending.length > 0}
          canSave
          pending={save.isPending}
          saveLabel={t("save")}
          onSave={submit}
          onDiscard={() => {
            setDrafts(initialDrafts());
            setInvalid(new Set());
          }}
        />
      )}
    </Panel>
  );
}

/**
 * The Questions tab: one card per round. The requester (`canAnswer`) answers with one control per question type,
 * or presses "Not sure"; the team sees the same rounds read-only with the answers.
 *
 * @param props.requestId the request
 * @param props.canAnswer whether the viewer may answer
 */
export function QuestionForm({ requestId, canAnswer }: { requestId: string; canAnswer: boolean }) {
  const t = useTranslations("events.questions");
  const trpc = useTRPC();
  const { data: rounds } = useSuspenseQuery(trpc.requests.rounds.queryOptions({ id: requestId }));
  if (rounds.length === 0) return <EmptyState title={t("emptyTitle")} description={t("emptyText")} />;
  return (
    <div className="flex flex-col gap-5">
      {rounds.map((round) => (
        <RoundCard key={round.id} requestId={requestId} round={round} canAnswer={canAnswer} />
      ))}
    </div>
  );
}
