import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { NotFoundScreen } from "@/components/status-screens";
import { Button } from "@/components/ui/button";

/** The 404 for addresses that match no page. */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col justify-center">
      <p className="px-4 font-display text-lg font-semibold sm:px-6 lg:px-9">Roadmap</p>
      <NotFoundScreen
        title={t("notFoundTitle")}
        text={t("notFoundText")}
        action={
          <Button asChild>
            <Link href="/">{t("goToProjects")}</Link>
          </Button>
        }
      />
    </main>
  );
}
