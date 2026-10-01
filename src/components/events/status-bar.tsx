import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/event-status";
import { cn } from "@/lib/utils";

/** The statuses of a request's normal life, in order; the stepper shows these. */
const STEPS = ["draft", "submitted", "accepted", "event_week", "done"] as const;

/**
 * The status of a request: a stepper through draft, submitted, accepted, event week and done with the
 * reached steps filled, or a badge for a withdrawn or cancelled request.
 *
 * @param props.status the request's status
 */
export function StatusBar({ status }: { status: RequestStatus }) {
  const t = useTranslations("events");
  if (status === "withdrawn" || status === "cancelled") {
    return (
      <Badge variant="destructive" aria-label={t("statusBar.label")}>
        {t(`status.${status}`)}
      </Badge>
    );
  }
  const reached = STEPS.indexOf(status);
  return (
    <ol aria-label={t("statusBar.label")} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2" aria-current={i === reached ? "step" : undefined}>
          <span
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 text-[12.5px]",
              i === reached ? "bg-primary font-semibold text-primary-foreground" : i < reached ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {t(`status.${step}`)}
            {i === reached && <span className="sr-only">{t("statusBar.current", { status: t(`status.${step}`) })}</span>}
          </span>
          {i < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
