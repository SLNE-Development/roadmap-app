"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { answerQuestionAction, setQuestionResolvedAction } from "@/app/(app)/p/[project]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";
import { splitAuthor } from "./activity/change-sentence";
import { AgentTag } from "./chips";
import { Markdown } from "./markdown";
import { PersonAvatar } from "./person-avatar";
import { useAction } from "./use-action";

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
  /** When the question was asked (ISO). */
  createdAt?: string;
  /** Who last answered it and when (ISO), when known from the change log. */
  answeredBy?: { author: string; createdAt: string } | null;
}

/**
 * One question as a card. Open and unanswered: the text and, for editors, an
 * answer form ("Save answer, keep open" or "Answer and resolve"). Answered but
 * open: the answer and "Mark resolved". Resolved: the answer and "Reopen".
 */
export function QuestionCard({ projectSlug, question: q, canEdit }: { projectSlug: string; question: QuestionView; canEdit: boolean }) {
  const { pending, act } = useAction();
  const [answer, setAnswer] = useState("");
  const asker = splitAuthor(q.author);
  const answered = q.answer !== null && q.answer !== "";
  const needsAnswer = !q.resolved && !answered;

  const save = (resolved: boolean) =>
    act(
      () => answerQuestionAction(projectSlug, { id: q.id, answer, resolved }),
      () => {
        setAnswer("");
        toast.success(resolved ? "Question resolved" : "Answer saved");
      },
    );
  const setResolved = (resolved: boolean) =>
    act(
      () => setQuestionResolvedAction(projectSlug, q.id, resolved),
      () => toast.success(resolved ? "Question resolved" : "Question reopened"),
    );

  return (
    <article
      aria-busy={pending}
      className={cn("flex flex-col border bg-card px-4 sm:px-5", needsAnswer ? "gap-3 py-[18px] focus-within:border-primary" : "gap-2.5 py-4")}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className={cn("min-w-0 flex-1 font-semibold", needsAnswer ? "text-base" : "text-[15px]", q.resolved && "text-fg-2")}>{q.title}</h2>
        {!q.resolved && answered && (
          <span className="bg-cat-review-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-cat-review">Answered, still open</span>
        )}
        {q.createdAt && (
          <time dateTime={q.createdAt} className="text-[12.5px] whitespace-nowrap text-muted-foreground">
            {relativeAge(q.createdAt)}
          </time>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <PersonAvatar name={asker.name} size="xs" />
        <span>{asker.name}</span>
        {asker.agent && <AgentTag agent={asker.agent} />}
        {q.systemSlug && (
          <>
            <span aria-hidden>·</span>
            <Link href={`/p/${projectSlug}/systems/${q.systemSlug}`} className="font-medium text-fg-2 hover:underline">
              {q.systemTitle}
            </Link>
          </>
        )}
      </div>
      {q.text && <Markdown className="max-w-none! text-[14.5px]! leading-[1.6]! text-fg-2">{q.text}</Markdown>}

      {answered && (
        <div className="flex flex-col gap-1 bg-secondary px-3.5 py-3">
          {q.answeredBy && (
            <span className="text-xs text-muted-foreground">
              {splitAuthor(q.answeredBy.author).name} · {relativeAge(q.answeredBy.createdAt)}
            </span>
          )}
          <Markdown className="max-w-none! text-sm! leading-[1.55]!">{q.answer ?? ""}</Markdown>
        </div>
      )}

      {canEdit && needsAnswer && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-fg-2">
            Your answer
            <Textarea
              rows={3}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="bg-background text-sm font-normal text-foreground"
              placeholder="Answer in a sentence or two; Markdown works."
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending || !answer.trim()} onClick={() => save(false)}>
              Save answer, keep open
            </Button>
            <Button type="submit" size="sm" disabled={pending || !answer.trim()}>
              Answer and resolve
            </Button>
          </div>
        </form>
      )}

      {canEdit && !needsAnswer && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setResolved(!q.resolved)}>
            {q.resolved ? "Reopen" : "Mark resolved"}
          </Button>
        </div>
      )}
    </article>
  );
}
