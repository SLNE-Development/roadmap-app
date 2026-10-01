import Link from "next/link";
import { useTranslations } from "next-intl";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";

/**
 * The content of a "this does not exist" page.
 *
 * @param props.title the page heading
 * @param props.text one line saying what is missing
 * @param props.action the way out, usually a link button
 */
export function NotFoundScreen({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <Page width="reading">
      <div className="flex flex-col items-start gap-3 py-8">
        <h1 className="font-display text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance">{title}</h1>
        <p className="text-sm leading-normal text-fg-2">{text}</p>
        <div className="mt-1">{action}</div>
      </div>
    </Page>
  );
}

/**
 * The content of an error boundary: what happened, a reference to quote, and a retry.
 *
 * @param props.digest the server-side error reference, when the error has one
 * @param props.onRetry renders the failed segment again
 * @param props.homeHref where the link out of the error goes
 */
export function ErrorScreen({ digest, onRetry, homeHref }: { digest?: string; onRetry: () => void; homeHref: string }) {
  const t = useTranslations("errors");
  const common = useTranslations("common");
  return (
    <Page width="reading">
      <div className="flex flex-col items-start gap-3 py-8">
        <h1 className="font-display text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance">{t("title")}</h1>
        <p className="text-sm leading-normal text-fg-2">{t("text")}</p>
        {digest && <p className="font-mono text-[12.5px] text-muted-foreground">{t("reference", { digest })}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button onClick={onRetry}>{common("retry")}</Button>
          <Button asChild variant="outline">
            <Link href={homeHref}>{t("goHome")}</Link>
          </Button>
        </div>
      </div>
    </Page>
  );
}
