"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { DirtyBar } from "@/components/events/dirty-bar";
import { MarkdownEditor } from "@/components/markdown-editor";
import { EmptyState, Panel } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EventFallbackRow } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** The four texts of a scenario, as typed. */
interface ScenarioDraft {
  title: string;
  whatWeDo: string;
  whoDecides: string;
  message: string;
}

/**
 * One scenario: what we do, who decides, and a prepared player message, saved together. The card keeps its own text and
 * baseline for as long as it is mounted (keyed by the scenario id), so a refetch never resets what is typed.
 */
function ScenarioCard({ requestId, scenario, canEdit }: { requestId: string; scenario: EventFallbackRow; canEdit: boolean }) {
  const t = useTranslations("events.fallback");
  const trpc = useTRPC();
  const id = useId();
  const initial: ScenarioDraft = { title: scenario.title, whatWeDo: scenario.whatWeDo, whoDecides: scenario.whoDecides, message: scenario.playerMessage ?? "" };
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const save = useMutation(
    trpc.requests.saveFallback.mutationOptions({
      // The baseline is what was sent; text typed while the save ran stays unsaved.
      onSuccess: (_row, vars) => {
        setSaved((s) => ({
          title: vars.title ?? s.title,
          whatWeDo: vars.whatWeDo ?? s.whatWeDo,
          whoDecides: vars.whoDecides ?? s.whoDecides,
          message: vars.playerMessage === undefined ? s.message : (vars.playerMessage ?? ""),
        }));
        toast.success(t("saved"));
      },
    }),
  );
  const remove = useMutation(trpc.requests.removeFallback.mutationOptions({ onSuccess: () => toast.success(t("removed")) }));
  const set = (field: keyof ScenarioDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const complete = draft.whatWeDo.trim() !== "" && draft.whoDecides.trim() !== "";
  const dirty = (Object.keys(draft) as (keyof ScenarioDraft)[]).some((k) => draft[k] !== saved[k]);
  const titleOk = scenario.required || draft.title.trim() !== "";
  return (
    <Panel
      title={
        scenario.required ? (
          draft.title
        ) : (
          <Input aria-label={t("titleLabel")} className="h-8 w-72 max-w-full font-sans text-[14px] font-semibold" value={draft.title} maxLength={120} disabled={!canEdit} onChange={(e) => set("title")(e.target.value)} />
        )
      }
      action={
        <>
          {scenario.required && <Badge variant="secondary">{t("required")}</Badge>}
          <Badge variant={complete ? "outline" : "destructive"}>{complete ? t("complete") : t("incomplete")}</Badge>
          {canEdit && !scenario.required && (
            <Button type="button" size="xs" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate({ id: requestId, fallbackId: scenario.id })}>
              {t("remove")}
              <span className="sr-only"> {saved.title}</span>
            </Button>
          )}
        </>
      }
      bodyClassName="pb-0"
    >
      <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5">
        <Field>
          <FieldLabel htmlFor={`${id}-do`}>{t("whatWeDo")}</FieldLabel>
          <MarkdownEditor id={`${id}-do`} variant="compact" value={draft.whatWeDo} maxLength={5000} minRows={4} disabled={!canEdit} onChange={set("whatWeDo")} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-who`}>{t("whoDecides")}</FieldLabel>
          <Input id={`${id}-who`} value={draft.whoDecides} maxLength={500} disabled={!canEdit} onChange={(e) => set("whoDecides")(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-msg`}>{t("playerMessage")}</FieldLabel>
          <Textarea id={`${id}-msg`} value={draft.message} maxLength={2000} disabled={!canEdit} onChange={(e) => set("message")(e.target.value)} />
          <FieldDescription>{t("playerMessageHelp")}</FieldDescription>
        </Field>
      </div>
      <DirtyBar
        dirty={canEdit && dirty}
        canSave={titleOk}
        pending={save.isPending}
        onSave={() =>
          save.mutate({
            id: requestId,
            fallbackId: scenario.id,
            ...(scenario.required ? {} : { title: draft.title }),
            whatWeDo: draft.whatWeDo,
            whoDecides: draft.whoDecides,
            playerMessage: draft.message.trim() ? draft.message : null,
          })
        }
        onDiscard={() => setDraft(saved)}
      />
    </Panel>
  );
}

/** The ghost card at the end of the list: a title field and a button that adds an empty scenario. */
function AddScenario({ requestId }: { requestId: string }) {
  const t = useTranslations("events.fallback");
  const trpc = useTRPC();
  const id = useId();
  const [title, setTitle] = useState("");
  const add = useMutation(trpc.requests.addFallback.mutationOptions({ onSuccess: () => setTitle("") }));
  return (
    <form
      className="flex flex-wrap items-end gap-3 border border-dashed px-4 py-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate({ id: requestId, title });
      }}
    >
      <Field className="min-w-48 flex-1">
        <FieldLabel htmlFor={id}>{t("newTitle")}</FieldLabel>
        <Input id={id} value={title} maxLength={120} placeholder={t("newPlaceholder")} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={add.isPending || !title.trim()}>
        <Plus aria-hidden />
        {t("add")}
      </Button>
    </form>
  );
}

/**
 * The Fallback tab: one card per scenario with what we do, who decides and a player message. The required
 * scenario must be complete before the event week can start.
 *
 * @param props.requestId the request
 * @param props.canEdit whether the actor may change the plan
 */
export function FallbackTab({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const t = useTranslations("events.fallback");
  const trpc = useTRPC();
  const { data: scenarios } = useSuspenseQuery(trpc.requests.fallbacks.queryOptions({ id: requestId }));
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {scenarios.length === 0 && <EmptyState title={t("emptyTitle")} description={t("emptyText")} />}
      {scenarios.map((s) => (
        <ScenarioCard key={s.id} requestId={requestId} scenario={s} canEdit={canEdit} />
      ))}
      {canEdit && <AddScenario requestId={requestId} />}
    </div>
  );
}
