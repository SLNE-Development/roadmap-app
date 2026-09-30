"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addQuestionAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/use-action";

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
  const { pending, act } = useAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [system, setSystem] = useState(defaultSystem);

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
          Ask a question
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => addQuestionAction(projectSlug, { title, text, system: system || undefined }),
              () => {
                setOpen(false);
                setTitle("");
                setText("");
                toast.success("Question added");
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Ask a question</DialogTitle>
            <DialogDescription>Open questions stay on the list until someone answers and resolves them.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="question-title">Question</FieldLabel>
              <Input id="question-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Who owns the staff panel after launch?" />
            </Field>
            <Field>
              <FieldLabel htmlFor="question-text">Details</FieldLabel>
              <Textarea id="question-text" value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} />
              <FieldDescription>Optional. Context that helps someone answer; Markdown works.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="question-system">System</FieldLabel>
              <NativeSelect id="question-system" className="w-full" value={system} onChange={(e) => setSystem(e.target.value)}>
                <NativeSelectOption value="">No system</NativeSelectOption>
                {systems.map((s) => (
                  <NativeSelectOption key={s.slug} value={s.slug}>
                    {s.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim()}>
              Ask question
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
