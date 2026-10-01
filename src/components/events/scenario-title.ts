import { useTranslations } from "next-intl";

/** Returns a function that gives the title of a scenario: translated for the required `server-down` one (stored in English), as written for a custom one. */
export function useScenarioTitle(): (scenario: { key: string | null; title: string }) => string {
  const t = useTranslations("events.fallback.titles");
  return (scenario) => (scenario.key === "server-down" ? t("server-down") : scenario.title);
}
