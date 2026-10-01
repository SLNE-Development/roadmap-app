import type { useTranslations } from "next-intl";
import type { HealthReason } from "@/lib/health";

/** The sentence for one health reason, from the `home.health.*` messages. */
export function healthReasonText(t: ReturnType<typeof useTranslations<"home">>, r: HealthReason): string {
  switch (r.code) {
    case "allDone":
      return t("health.allDone");
    case "noChanges":
      return r.days === null ? t("health.neverChanged", { limit: r.limit }) : t("health.noChanges", { days: r.days });
    case "quietProgress":
      return t("health.quietProgress", { stale: r.stale, total: r.total });
    case "blocked":
      return t("health.blocked", { blocked: r.blocked, open: r.open });
    case "staleSystems":
      return t("health.staleSystems", { count: r.count, days: r.days });
    case "blockingQuestions":
      return t("health.blockingQuestions", { count: r.count });
  }
}
