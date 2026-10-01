"use client";

import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EventFallbackRow } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** One scenario: what we do, who decides, and a prepared player message, saved together. */
function ScenarioCard({ requestId, scenario, canEdit }: { requestId: string; scenario: EventFallbackRow; canEdit: boolean }) {
  const t = useTranslations("events.fallback");
  const trpc = useTRPC();
  const id = useId();
  const [title, setTitle] = useState(scenario.title);
  const [whatWeDo, setWhatWeDo] = useState(scenario.whatWeDo);
  const [whoDecides, setWhoDecides] = useState(scenario.whoDecides);
  const [message, setMessage] = useState(scenario.playerMessage ?? "");
  const save = useMutation(trpc.requests.saveFallback.mutationOptions({ onSuccess: () => toast.success(t("saved")) }));
  const remove = useMutation(trpc.requests.removeFallback.mutationOptions({ onSuccess: () => toast.success(t("removed")) }));
  const complete = whatWeDo.trim() !== "" && whoDecides.trim() !== "";
  const dirty = title !== scenario.title || whatWeDo !== scenario.whatWeDo || whoDecides !== scenario.whoDecides || message !== (scenario.playerMessage ?? "");
  return (
    <form
      className="flex flex-col gap-4 border bg-card p-4 sm:p-5"
      aria-label={scenario.title}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: requestId, fallbackId: scenario.id, ...(scenario.required ? {} : { title }), whatWeDo, whoDecides, playerMessage: message.trim() ? message : null });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {scenario.required ? <h3 className="text-[15px] font-semibold">{scenario.title}</h3> : (
          <Input aria-label={t("titleLabel")} className="max-w-sm" value={title} maxLength={120} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        )}
        {scenario.required && <Badge variant="secondary">{t("required")}</Badge>}
        <Badge variant={complete ? "outline" : "destructive"}>{complete ? t("complete") : t("incomplete")}</Badge>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-do`}>{t("whatWeDo")}</FieldLabel>
        <Textarea id={`${id}-do`} value={whatWeDo} maxLength={5000} disabled={!canEdit} onChange={(e) => setWhatWeDo(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-who`}>{t("whoDecides")}</FieldLabel>
        <Input id={`${id}-who`} value={whoDecides} maxLength={500} disabled={!canEdit} onChange={(e) => setWhoDecides(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-msg`}>{t("playerMessage")}</FieldLabel>
        <Textarea id={`${id}-msg`} value={message} maxLength={2000} disabled={!canEdit} onChange={(e) => setMessage(e.target.value)} />
        <FieldDescription>{t("playerMessageHelp")}</FieldDescription>
      </Field>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || !dirty || (!scenario.required && !title.trim())}>
            {t("save")}
          </Button>
          {!scenario.required && (
            <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate({ id: requestId, fallbackId: scenario.id })}>
              {t("remove")}
            </Button>
          )}
        </div>
      )}
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
  const id = useId();
  const [title, setTitle] = useState("");
  const { data: scenarios } = useSuspenseQuery(trpc.requests.fallbacks.queryOptions({ id: requestId }));
  const add = useMutation(trpc.requests.addFallback.mutationOptions({ onSuccess: () => setTitle("") }));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">{t("help")}</p>
      {scenarios.map((s) => (
        <ScenarioCard key={s.id} requestId={requestId} scenario={s} canEdit={canEdit} />
      ))}
      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ id: requestId, title });
          }}
        >
          <Field className="max-w-sm">
            <FieldLabel htmlFor={id}>{t("newTitle")}</FieldLabel>
            <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline" disabled={add.isPending || !title.trim()}>
            {t("add")}
          </Button>
        </form>
      )}
    </div>
  );
}
