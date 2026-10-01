/** The sections of the project overview, in their default order. */
export const OVERVIEW_PANELS = ["status", "attention", "phases", "updates"] as const;
export type PanelId = (typeof OVERVIEW_PANELS)[number];

const isPanel = (id: unknown): id is PanelId => OVERVIEW_PANELS.includes(id as PanelId);

/**
 * Resolves the `overview.panels` preference into the panels to render, in order.
 * An invalid preference gives the default order with all visible; unknown ids are
 * dropped and panels missing from `order` are appended visible in default order.
 *
 * @param pref the stored value, `{ order, hidden }`
 */
export function resolvePanels(pref: unknown): { id: PanelId; visible: boolean }[] {
  const p = pref as { order?: unknown; hidden?: unknown } | null;
  const valid = typeof p === "object" && p !== null && Array.isArray(p.order) && Array.isArray(p.hidden);
  const order = valid ? (p.order as unknown[]).filter(isPanel) : [];
  const hidden = new Set(valid ? (p.hidden as unknown[]) : []);
  const ids = [...new Set([...order, ...OVERVIEW_PANELS])];
  return ids.map((id) => ({ id, visible: !hidden.has(id) }));
}
