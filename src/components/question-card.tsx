"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useNow } from "@/components/clock";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_PRIORITIES, type QuestionPriority } from "@/db/schema";
import { relativeAge } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { AgentTag } from "./chips";
import { Markdown } from "./markdown";
import { PersonAvatar } from "./person-avatar";

/** A question as the questions page passes it in. */
export interface QuestionView {
  id: string;
  title: string;
  text: string;
  answer: string | null;
  resolved: boolean;
  priority: QuestionPriority;
  systemSlug: string | null;
  systemTitle: string | null;
  /** The person who asked. */
  authorName: string;
  /** The agent that asked for them, or `null`. */
  agent: string | null;
  /** When the question was asked (ISO). */
  createdAt?: string;
  /** Who last answered it, with the agent that answered for them, and when (ISO); `null` while unanswered. */
  answeredBy?: { name: string; agent: string | null; at: string } | null;
}

/** Menu labels of the priorities. */
const PRIORITY_LABEL: Record<QuestionPriority, string> = { blocking: "Blocking", normal: "Normal", nice: "Nice to know" };

/**
 * One question as a card. Open and unanswered: the text and, for editors, an
 * answer form ("Save answer, keep open" or "Answer and resolve"). Answered but
 * open: the answer and "Mark resolved". Resolved: the answer and "Reopen".
 */
export function QuestionCard({ projectSlug, question: q, canEdit }: { projectSlug: string; question: QuestionView; canEdit: boolean }) {
  const trpc = useTRPC();
  const [answer, setAnswer] = useState("");
  const now = useNow();
  // Follow-ups sit on the hooks, not on `mutate`: resolving or reopening moves the card to the other tab, unmounting it.
  const answerQuestion = useMutation(
    trpc.questions.answer.mutationOptions({
      onSuccess: (_data, { answer: { resolved } }) => {
        setAnswer("");
        toast.success(resolved ? "Question resolved" : "Answer saved");
      },
    }),
  );
  const resolve = useMutation(
    trpc.questions.setResolved.mutationOptions({
      onSuccess: (_data, { resolved }) => toast.success(resolved ? "Question resolved" : "Question reopened"),
    }),
  );
  const setPriority = useMutation(
    trpc.questions.setPriority.mutationOptions({ onSuccess: (_data, { priority }) => toast.success(`Priority set to ${PRIORITY_LABEL[priority].toLowerCase()}`) }),
  );
  const pending = answerQuestion.isPending || resolve.isPending || setPriority.isPending;
  const answered = q.answer !== null && q.answer !== "";
  const needsAnswer = !q.resolved && !answered;

  const save = (resolved: boolean) => answerQuestion.mutate({ project: projectSlug, answer: { id: q.id, answer, resolved } });
  const setResolved = (resolved: boolean) => resolve.mutate({ project: projectSlug, id: q.id, resolved });

  return (
    <article
      id={`q-${q.id}`}
      tabIndex={0}
      data-nav-item
      aria-busy={pending}
      className={cn("flex flex-col border bg-card px-4 sm:px-5", needsAnswer ? "gap-3 py-[18px] focus-within:border-primary" : "gap-2.5 py-4")}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className={cn("min-w-0 flex-1 font-semibold", needsAnswer ? "text-base" : "text-[15px]", q.resolved && "text-fg-2")}>{q.title}</h2>
        {!q.resolved && answered && (
          <span className="bg-cat-review-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-cat-review">Answered, still open</span>
        )}
        {q.priority === "blocking" && <span className="bg-cat-blocked-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-cat-blocked">Blocking</span>}
        {q.priority === "nice" && <span className="bg-secondary px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-muted-foreground">Nice to know</span>}
        {q.createdAt && (
          <time dateTime={q.createdAt} className="text-[12.5px] whitespace-nowrap text-muted-foreground">
            {relativeAge(q.createdAt, now)}
          </time>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <PersonAvatar name={q.authorName} size="xs" />
        <span>{q.authorName}</span>
        {q.agent && <AgentTag agent={q.agent} />}
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
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span>{q.answeredBy.name}</span>
              {q.answeredBy.agent && <AgentTag agent={q.answeredBy.agent} />}
              <span aria-hidden>·</span>
              <time dateTime={q.answeredBy.at}>{relativeAge(q.answeredBy.at, now)}</time>
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

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={pending} aria-label={`Priority of ${q.title}: ${PRIORITY_LABEL[q.priority]}`}>
                Priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                value={q.priority}
                onValueChange={(value) => setPriority.mutate({ project: projectSlug, id: q.id, priority: value as QuestionPriority })}
              >
                {QUESTION_PRIORITIES.map((p) => (
                  <DropdownMenuRadioItem key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {!needsAnswer && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setResolved(!q.resolved)}>
              {q.resolved ? "Reopen" : "Mark resolved"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
