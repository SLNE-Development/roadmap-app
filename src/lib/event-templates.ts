import { z } from "zod";

/** A `#rrggbb` colour. */
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #c23636.");

/** A message embed the settings hold a template for (disaster and resolved); texts may hold placeholders. */
export const embedTemplateSchema = z.strictObject({
  title: z.string().max(256),
  text: z.string().max(4096),
  color,
  imageUploadId: z.string().min(1).max(64).nullable(),
});

/** The template of the details embed: a line per fact, a colour and a footer. */
export const detailsTemplateSchema = z.strictObject({
  lines: z.array(z.string().max(200)).max(10, "A details template has at most 10 lines."),
  color,
  footer: z.string().max(200),
});

/** A disaster or resolved template. */
export type EmbedTemplate = z.infer<typeof embedTemplateSchema>;

/** The details template. */
export type DetailsTemplate = z.infer<typeof detailsTemplateSchema>;

/** The disaster message until the managers change it. German, because it is posted as written. */
export const DEFAULT_DISASTER_TEMPLATE: EmbedTemplate = {
  title: "Wir arbeiten an einer Lösung",
  text: "{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht.",
  color: "#c23636",
  imageUploadId: null,
};

/** The resolved message until the managers change it. */
export const DEFAULT_RESOLVED_TEMPLATE: EmbedTemplate = {
  title: "Das Event ist nun wieder online",
  text: "{event} läuft wieder. {note}",
  color: "#1a7048",
  imageUploadId: null,
};

/** The details embed until the managers change it. */
export const DEFAULT_DETAILS_TEMPLATE: DetailsTemplate = {
  lines: ["Datum: {date}", "Uhrzeit: {time}", "Dauer: {duration}", "Ort: {where}", "Infos: {docs}", "Regeln: {rules}"],
  color: "#2a5db0",
  footer: "Viel Spaß!",
};

/** The style guides used when the stored one is empty, so a prompt never carries an empty style. */
export const DEFAULT_STYLE_GUIDES = {
  announcement: "Freundlich, einladend und klar. Kurze Sätze, gern ein paar passende Emojis, keine Fachbegriffe.",
  team: "Sachlich und knapp, direkt an das Team gerichtet: was ansteht, wer was tut und bis wann.",
} as const;
