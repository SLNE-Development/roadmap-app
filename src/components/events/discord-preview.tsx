import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";
import type { Embed } from "@/lib/discord-limits";
import { renderTimestamps } from "@/lib/discord-timestamp";

/** One piece of a message: plain text, an embed card or the link to the Discord event. */
export interface PreviewPart {
  kind: "text" | "embed" | "event-link";
  content: string;
  embed?: Embed;
}

/** The href that marks a role mention for the pill style below; the markdown renderer keeps it as a link. */
const MENTION_HREF = "#discord-mention";

/** Classes for the pill: role mentions are links to `MENTION_HREF`. */
const PILL = "[&_a[href='#discord-mention']]:pointer-events-none [&_a[href='#discord-mention']]:bg-brand-soft [&_a[href='#discord-mention']]:px-1 [&_a[href='#discord-mention']]:font-medium [&_a[href='#discord-mention']]:text-brand-strong [&_a[href='#discord-mention']]:no-underline";

/**
 * Discord-style message group: the post-as name with an avatar, then each part the way Discord shows it. Timestamp
 * tokens read as local time in `locale`/`timeZone`; role mentions become an `@Event` pill. Nothing here is sent.
 *
 * @param props.parts the message parts in order
 * @param props.postAs the name Discord shows for the sender
 */
export function DiscordPreview({ parts, postAs, locale, timeZone }: { parts: PreviewPart[]; postAs: string; locale: string; timeZone: string }) {
  const t = useTranslations("events.discordPreview");
  const plain = (text: string) => renderTimestamps(text, locale, timeZone);
  const rich = (text: string) => plain(text).replace(/<@&\d+>/g, `[@${t("mention")}](${MENTION_HREF})`);
  return (
    <div role="group" aria-label={t("label")} className="flex gap-3 border bg-card px-4 py-3">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-sm font-semibold text-brand-strong">
        {postAs.trim().charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-sm font-semibold">{postAs}</span>
        {parts.map((part, i) => {
          if (part.kind === "event-link") {
            return (
              <div key={i} className="flex max-w-md items-start gap-2.5 border bg-muted/40 px-3 py-2.5 text-sm">
                <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-strong" />
                <div className="min-w-0">
                  <div className="font-medium">{t("eventCard")}</div>
                  <div className="break-all text-[13px] text-fg-2">{part.content}</div>
                </div>
              </div>
            );
          }
          if (part.kind === "embed" && part.embed) return <EmbedCard key={i} embed={part.embed} rich={rich} plain={plain} />;
          return <Markdown key={i} className={`text-sm ${PILL}`}>{rich(part.content)}</Markdown>;
        })}
      </div>
    </div>
  );
}

/** An embed card: colour bar, author, title, description, fields, image or thumbnail and footer. */
function EmbedCard({ embed, rich, plain }: { embed: Embed; rich: (text: string) => string; plain: (text: string) => string }) {
  const image = embed.imageUploadId ? `/api/uploads/${embed.imageUploadId}` : null;
  const thumbnail = image && embed.imageAs === "thumbnail";
  return (
    <div className="max-w-xl border border-l-4 bg-muted/40 px-3 py-2.5" style={{ borderLeftColor: embed.color }}>
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {embed.author && <span className="text-xs font-medium">{plain(embed.author)}</span>}
          {embed.title &&
            (embed.url ? (
              <a href={embed.url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold text-brand-strong hover:underline">
                {plain(embed.title)}
              </a>
            ) : (
              <span className="text-sm font-semibold">{plain(embed.title)}</span>
            ))}
          {embed.description && <Markdown className={`text-[13px] ${PILL}`}>{rich(embed.description)}</Markdown>}
          {embed.fields.map((field, i) => (
            <div key={i}>
              <div className="text-[13px] font-semibold">{plain(field.name)}</div>
              <Markdown className={`text-[13px] ${PILL}`}>{rich(field.value)}</Markdown>
            </div>
          ))}
        </div>
        {thumbnail && <img src={image} alt="" className="size-16 shrink-0 self-start object-cover" />}
      </div>
      {image && !thumbnail && <img src={image} alt="" className="mt-2 max-h-72 max-w-full object-contain" />}
      {embed.footer && <div className="mt-2 text-xs text-fg-2">{plain(embed.footer)}</div>}
    </div>
  );
}
