"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/** The `value` of the "New system" option of the system select. */
const NEW_SYSTEM = "";

/**
 * The dialog that accepts a submitted request: the "Create project" tab builds a project from the event template,
 * the "Link to an existing project" tab links a project the actor edits.
 *
 * @param props.request the request's id, title and event end (the project deadline)
 */
export function AcceptDialog({
  request,
  open,
  onOpenChange,
}: {
  request: { id: string; title: string; end: Date | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("events.accept");
  const tc = useTranslations("common");
  const format = useFormatter();
  const trpc = useTRPC();
  const id = useId();
  const [tab, setTab] = useState<"create" | "link">("create");
  const [name, setName] = useState(request.title);
  const [slug, setSlug] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [system, setSystem] = useState(NEW_SYSTEM);
  const linkable = useQuery({ ...trpc.requests.linkable.queryOptions(), enabled: open && tab === "link" });
  const accept = useMutation(
    trpc.requests.accept.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("accepted"));
      },
    }),
  );
  const projects = linkable.data ?? [];
  const chosen = projects.find((p) => p.slug === target);
  const shownSlug = slug ?? slugify(name);
  const canSubmit = !accept.isPending && (tab === "create" ? name.trim() !== "" && shownSlug !== "" : chosen !== undefined);
  const submit = () => {
    if (tab === "link") {
      accept.mutate({ id: request.id, mode: "link", project: target, ...(system ? { system } : {}) });
      return;
    }
    accept.mutate({
      id: request.id,
      mode: "create",
      ...(name.trim() !== request.title ? { projectName: name } : {}),
      ...(slug !== null ? { projectSlug: slug } : {}),
    });
  };
  const tabs = [
    { key: "create", label: t("tabCreate") },
    { key: "link", label: t("tabLink") },
  ] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-semibold">{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div role="tablist" aria-label={t("tabs")} className="flex gap-4 border-b">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`${id}-${item.key}-tab`}
                aria-selected={tab === item.key}
                aria-controls={`${id}-${item.key}`}
                className={cn("-mb-px border-b-2 px-1 pb-2 text-[13.5px] font-medium", tab === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === "create" ? (
            <FieldGroup role="tabpanel" id={`${id}-create`} aria-labelledby={`${id}-create-tab`}>
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>{t("projectName")}</FieldLabel>
                <Input id={`${id}-name`} value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-slug`}>{t("projectSlug")}</FieldLabel>
                <Input id={`${id}-slug`} value={shownSlug} maxLength={64} className="font-mono text-[13px]" onChange={(e) => setSlug(slugify(e.target.value))} />
                <FieldDescription>{t("slugPreview", { slug: shownSlug })}</FieldDescription>
              </Field>
              {request.end && <p className="text-[13px] text-fg-2">{t("deadlineValue", { date: format.dateTime(request.end, { dateStyle: "medium", timeStyle: "short" }) })}</p>}
              <p className="text-[13px] text-muted-foreground">{t("createHelp")}</p>
            </FieldGroup>
          ) : (
            <FieldGroup role="tabpanel" id={`${id}-link`} aria-labelledby={`${id}-link-tab`}>
              {linkable.isSuccess && projects.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t("noProjects")}</p>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-project`}>{t("project")}</FieldLabel>
                    <NativeSelect
                      id={`${id}-project`}
                      className="w-full"
                      value={target}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        setSystem(NEW_SYSTEM);
                      }}
                    >
                      <NativeSelectOption value="">{t("projectPlaceholder")}</NativeSelectOption>
                      {projects.map((p) => (
                        <NativeSelectOption key={p.slug} value={p.slug}>
                          {p.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-system`}>{t("system")}</FieldLabel>
                    <NativeSelect id={`${id}-system`} className="w-full" value={system} disabled={!chosen} onChange={(e) => setSystem(e.target.value)}>
                      <NativeSelectOption value={NEW_SYSTEM}>{t("newSystem")}</NativeSelectOption>
                      {chosen?.systems.map((s) => (
                        <NativeSelectOption key={s.slug} value={s.slug}>
                          {s.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{t("linkHelp")}</FieldDescription>
                  </Field>
                </>
              )}
            </FieldGroup>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
