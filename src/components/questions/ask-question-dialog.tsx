"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { MentionTextarea } from "@/components/mentions/mention-textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { QuestionPriority } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** The "Ask a question" button and its dialog: title, optional details and an optional system. */
export function AskQuestionDialog({
  projectSlug,
  systems,
  defaultSystem = "",
}: {
  projectSlug: string;
  systems: { slug: string; title: string }[];
  defaultSystem?: string;
}) {
  const t = useTranslations("questions.ask");
  const tp = useTranslations("questions.priority");
  const trpc = useTRPC();
  const add = useMutation(trpc.questions.add.mutationOptions());
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [system, setSystem] = useState(defaultSystem);
  const [priority, setPriority] = useState<QuestionPriority>("normal");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSystem(defaultSystem);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(
              { project: projectSlug, question: { title, text, system: system || undefined, priority } },
              {
                onSuccess: () => {
                  setOpen(false);
                  setTitle("");
                  setText("");
                  setPriority("normal");
                  toast.success(t("added"));
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="question-title">{t("questionLabel")}</FieldLabel>
              <Input id="question-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("questionPlaceholder")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="question-text">{t("detailsLabel")}</FieldLabel>
              <MentionTextarea id="question-text" projectSlug={projectSlug} value={text} maxLength={5000} onValueChange={setText} />
              <FieldDescription>{t("detailsHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="question-system">{t("systemLabel")}</FieldLabel>
              <NativeSelect id="question-system" className="w-full" value={system} onChange={(e) => setSystem(e.target.value)}>
                <NativeSelectOption value="">{t("noSystem")}</NativeSelectOption>
                {systems.map((s) => (
                  <NativeSelectOption key={s.slug} value={s.slug}>
                    {s.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="question-priority">{t("priorityLabel")}</FieldLabel>
              <NativeSelect id="question-priority" className="w-full" value={priority} onChange={(e) => setPriority(e.target.value as QuestionPriority)}>
                <NativeSelectOption value="normal">{tp("normal")}</NativeSelectOption>
                <NativeSelectOption value="blocking">{tp("blocking")}</NativeSelectOption>
                <NativeSelectOption value="nice">{tp("nice")}</NativeSelectOption>
              </NativeSelect>
              <FieldDescription>{t("priorityHelp")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={add.isPending || !title.trim()}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
