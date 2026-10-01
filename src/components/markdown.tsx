import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { TaskStateChip } from "@/components/chips";
import { MentionChip } from "@/components/mentions/mention-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TaskState } from "@/db/schema";
import { rehypeGlossary, type GlossaryTerm } from "@/lib/glossary-match";
import { stepNumberOf } from "@/lib/plan-steps";

/** The task state of each plan step, by step number. */
export type StepStates = Map<number, { taskId: number; state: TaskState }>;

/** The href of a mention token, `user:<id>`. */
const MENTION_HREF = /^user:([A-Za-z0-9_-]{1,64})$/;

/** Keeps mention hrefs and otherwise applies react-markdown's default transform, which removes unsafe URLs. */
function urlTransform(url: string): string {
  return MENTION_HREF.test(url) ? url : defaultUrlTransform(url);
}

/**
 * Renders GitHub-flavoured markdown written by people or agents. Raw HTML is
 * skipped and unsafe URLs (such as `javascript:`) are removed by react-markdown's
 * default URL transform; links open in a new tab. Mention tokens (`[@Name](user:<id>)`)
 * render as chips.
 *
 * @param props.headingIds give headings ids (as `extractHeadings` computes them)
 *   and h1-h3 a hover link to their section; only specs and plans set it
 * @param props.stepStates the task state of each plan step; a heading such as
 *   "Step 2: ..." with an entry ends in a state chip. Only the plan sets it
 * @param props.glossary the project glossary; the first whole-word occurrence of each term (outside
 *   code, links and headings) gets a tooltip with its definition
 */
export function Markdown({
  children,
  className,
  headingIds,
  stepStates,
  glossary,
}: {
  children: string;
  className?: string;
  headingIds?: boolean;
  stepStates?: StepStates;
  glossary?: GlossaryTerm[];
}) {
  return (
    <div className={className ? `prose-md ${className}` : "prose-md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[...(headingIds ? [rehypeSlug] : []), ...(glossary?.length ? [rehypeGlossary(glossary)] : [])]}
        skipHtml
        urlTransform={urlTransform}
        components={{
          h1: (props) => <SectionHeading level={1} linked={headingIds} stepStates={stepStates} {...props} />,
          h2: (props) => <SectionHeading level={2} linked={headingIds} stepStates={stepStates} {...props} />,
          h3: (props) => <SectionHeading level={3} linked={headingIds} stepStates={stepStates} {...props} />,
          // react-markdown passes the hast `node`, which must not reach the DOM.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          a: ({ node: _node, ...props }) => {
            const mention = props.href ? MENTION_HREF.exec(props.href) : null;
            if (mention) return <MentionChip name={headingLabel(props.children).replace(/^@/, "")} userId={mention[1]} />;
            return <a {...props} target="_blank" rel="noreferrer noopener" />;
          },
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          abbr: ({ node: _node, title, children }) => <GlossaryAbbr definition={title}>{children}</GlossaryAbbr>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** A glossary term in running text: focusable, with its definition in a tooltip. */
function GlossaryAbbr({ definition, children }: { definition?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <abbr tabIndex={0} data-glossary="" className="cursor-help underline decoration-dotted underline-offset-2">
          {children}
        </abbr>
      </TooltipTrigger>
      <TooltipContent>{definition}</TooltipContent>
    </Tooltip>
  );
}

/** An h1-h3 that, when `linked`, ends in a hover anchor to its own id and, for a plan step with a task, a state chip. */
function SectionHeading({
  level,
  linked,
  stepStates,
  node,
  children,
  ...props
}: ComponentProps<"h1"> & { level: 1 | 2 | 3; linked?: boolean; stepStates?: StepStates; node?: unknown }) {
  // react-markdown passes the hast `node`, which must not reach the DOM.
  void node;
  const Tag = `h${level}` as const;
  const step = stepStates ? stepNumberOf(headingLabel(children)) : null;
  const task = step === null ? undefined : stepStates?.get(step);
  return (
    <Tag {...props} className={linked ? "group" : undefined}>
      {children}
      {task && <TaskStateChip state={task.state} className="ml-2 align-middle" />}
      {linked && props.id && (
        <a
          href={`#${props.id}`}
          aria-label={`Link to section ${headingLabel(children)}`}
          className="ml-2 text-muted-foreground no-underline opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
      )}
    </Tag>
  );
}

/** The plain text of heading (or link) children, for an accessible name. */
function headingLabel(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(headingLabel).join("");
  if (typeof children === "object" && "props" in children) return headingLabel((children.props as { children?: ReactNode }).children);
  return "";
}
