"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NotFoundScreen } from "@/components/status-screens";
import { Button } from "@/components/ui/button";

/** The link back to the overview; `not-found.tsx` gets no params, so it reads the slug itself. */
function OverviewLink() {
  const t = useTranslations("errors");
  const { project } = useParams<{ project: string }>();
  return (
    <Button asChild>
      <Link href={`/p/${project}`}>{t("backToOverview")}</Link>
    </Button>
  );
}

/** Shown inside the project shell when a system, board or decision does not exist. */
export default function ProjectNotFound() {
  const t = useTranslations("errors");
  return (
    <NotFoundScreen
      title={t("projectNotFoundTitle")}
      text={t("projectNotFoundText")}
      action={<OverviewLink />}
    />
  );
}
