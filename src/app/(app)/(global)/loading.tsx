import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { cn } from "@/lib/utils";

/** A block of the loading skeleton. */
function Block({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted motion-reduce:animate-none", className)} />;
}

/** Skeleton shown while a page loads: a title bar and three panels in the page layout. */
export default function Loading() {
  const t = useTranslations("common");
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{t("loading")}</span>
      <Page>
        <Block className="h-9 w-64" />
        <Block className="h-40" />
        <Block className="h-40" />
        <Block className="h-40" />
      </Page>
    </div>
  );
}
