import { useTranslations } from "next-intl";
import { CATEGORY_CLASS } from "@/components/chips";
import type { RequestProgress } from "@/lib/ops/request-link";

/** The segments of the bar, in order, with the colour of the matching board category. */
const SEGMENTS = [
  { key: "done", className: CATEGORY_CLASS.done },
  { key: "doing", className: CATEGORY_CLASS.active },
  { key: "blocked", className: CATEGORY_CLASS.blocked },
  { key: "todo", className: CATEGORY_CLASS.todo },
] as const;

/**
 * The build progress of an event: a bar with done, doing, blocked and to-do segments and a sentence such as "18 of 24 tasks done".
 * Read-only; it shows counts and never task titles.
 *
 * @param props.progress the counts of the linked project
 */
export function EventProgressBar({ progress }: { progress: RequestProgress }) {
  const t = useTranslations("events.progress");
  const { total, done } = progress;
  return (
    <section aria-label={t("label")} className="flex flex-col gap-2.5 border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[15px] font-semibold">{t("title")}</h2>
        <span className="text-[13px] text-muted-foreground">{total === 0 ? t("none") : t("summary", { done, total })}</span>
      </div>
      <div role="progressbar" aria-label={t("label")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="flex h-2.5 gap-[3px]">
        {total === 0 ? <span className="flex-1 bg-track" /> : SEGMENTS.filter((s) => progress[s.key] > 0).map((s) => <span key={s.key} className={s.className} style={{ flexGrow: progress[s.key] }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-[7px] text-[13px] text-fg-2">
            <span aria-hidden className={`size-2 rounded-full ${s.className}`} />
            {t(s.key)} <b className="font-semibold text-foreground">{progress[s.key]}</b>
          </li>
        ))}
      </ul>
      {progress.archived && <p className="text-[13px] text-muted-foreground">{t("archived")}</p>}
    </section>
  );
}
