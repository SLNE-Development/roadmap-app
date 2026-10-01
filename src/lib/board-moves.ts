/** Hold time before a touch press turns into a card drag. */
export const LONG_PRESS_MS = 250;
/** Finger travel that cancels a press, so the page can scroll instead. */
export const DRAG_SLOP_PX = 8;

/** The columns left and right of `currentColumnId` in board order; `null` at either end. */
export function moveTargets(columns: { id: string }[], currentColumnId: string): { left: string | null; right: string | null } {
  const i = columns.findIndex((c) => c.id === currentColumnId);
  if (i < 0) return { left: null, right: null };
  return { left: columns[i - 1]?.id ?? null, right: columns[i + 1]?.id ?? null };
}

/** `"left"` or `"right"` for Alt+ArrowLeft / Alt+ArrowRight with no other modifier (Option on macOS), else `null`. */
export function moveKey(event: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): "left" | "right" | null {
  if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowLeft") return "left";
  if (event.key === "ArrowRight") return "right";
  return null;
}

/** The `data-column-id` of the nearest element at the point, walking up from the hit element; `null` outside any column. */
export function columnIdAt(point: { x: number; y: number }, hit: (x: number, y: number) => Element | null): string | null {
  for (let el = hit(point.x, point.y); el; el = el.parentElement) {
    const id = el.getAttribute("data-column-id");
    if (id) return id;
  }
  return null;
}

/** Whether a pending focus target may be consumed: the card exists and sits in the column it must end up in. */
export function focusReady(target: { columnId: string }, cardColumnId: string | null): boolean {
  return cardColumnId === target.columnId;
}
