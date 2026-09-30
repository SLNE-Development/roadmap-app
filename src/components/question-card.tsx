"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { answerQuestionAction, setQuestionResolvedAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";

/** A question as the questions page passes it in. */
export interface QuestionView {
  id: string;
  title: string;
  text: string;
  answer: string | null;
  resolved: boolean;
  systemSlug: string | null;
  systemTitle: string | null;
  author: string;
}

/** One question with its answer, an answer form and the resolved toggle. */
export function QuestionCard({ projectSlug, question: q, canEdit }: { projectSlug: string; question: QuestionView; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState("");
  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle className={q.resolved ? "text-muted-foreground line-through" : ""}>{q.title}</CardTitle>
        <CardDescription>
          {q.author}
          {q.systemSlug && (
            <>
              {" · "}
              <Link href={`/p/${projectSlug}/systems/${q.systemSlug}`} className="underline">
                {q.systemTitle}
              </Link>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.text && <Markdown className="text-sm">{q.text}</Markdown>}
        {q.answer && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">Answer:</span> <Markdown>{q.answer}</Markdown>
          </div>
        )}
        {canEdit && !q.resolved && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await answerQuestionAction(projectSlug, { id: q.id, answer });
                if (!result.ok) return void toast.error(result.error);
                setAnswer("");
              });
            }}
          >
            <Textarea aria-label={`Answer to ${q.title}`} placeholder="Answer and resolve" value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <Button type="submit" variant="outline" className="self-start" disabled={pending || !answer.trim()}>
              Answer
            </Button>
          </form>
        )}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`resolved-${q.id}`}
              checked={q.resolved}
              disabled={pending}
              onCheckedChange={(checked) =>
                startTransition(async () => {
                  const result = await setQuestionResolvedAction(projectSlug, q.id, checked === true);
                  if (!result.ok) toast.error(result.error);
                })
              }
            />
            <Label htmlFor={`resolved-${q.id}`}>Resolved</Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
