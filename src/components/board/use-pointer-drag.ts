import { useEffect, useRef, useState } from "react";
import { columnIdAt, DRAG_SLOP_PX, LONG_PRESS_MS } from "@/lib/board-moves";

/** Distance from the scroll container's edge where dragging scrolls it. */
const EDGE_PX = 40;
/** Pixels scrolled per tick (every 16 ms) at the edge. */
const SCROLL_STEP = 12;

interface Press {
  slug: string;
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
}

/** The nearest ancestor that scrolls horizontally. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollWidth > p.clientWidth) return p;
  }
  return null;
}

/**
 * Touch and pen dragging for cards (mouse keeps native drag). A press held for
 * `LONG_PRESS_MS` without moving more than `DRAG_SLOP_PX` starts a drag; moving
 * earlier cancels it so the page scrolls. While dragging, `overColumnId` follows
 * the pointer (via `data-column-id` ancestors) and the nearest horizontal scroll
 * container scrolls near its edges. Releasing over a column calls `onDrop`.
 */
export function usePointerDrag({ enabled, onDrop }: { enabled: boolean; onDrop: (slug: string, columnId: string) => void }): {
  bind: (slug: string) => React.HTMLAttributes<HTMLElement>;
  draggingSlug: string | null;
  overColumnId: string | null;
} {
  const [draggingSlug, setDraggingSlug] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const active = useRef<Press | null>(null);
  const over = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroller = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pointerX = useRef(0);
  const drop = useRef(onDrop);
  useEffect(() => {
    drop.current = onDrop;
  });

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(scroller.current);
    press.current = null;
    active.current = null;
    over.current = null;
    setDraggingSlug(null);
    setOverColumnId(null);
  };
  useEffect(() => () => {
    clearTimeout(timer.current);
    clearInterval(scroller.current);
  }, []);

  // A drag in progress must not scroll the page; touch-action only applies to touches that start after it is set.
  useEffect(() => {
    if (!draggingSlug) return;
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [draggingSlug]);

  const begin = () => {
    const p = press.current;
    if (!p) return;
    active.current = p;
    p.el.setPointerCapture(p.pointerId);
    setDraggingSlug(p.slug);
    const area = scrollParent(p.el);
    if (area) {
      scroller.current = setInterval(() => {
        const rect = area.getBoundingClientRect();
        if (pointerX.current < rect.left + EDGE_PX) area.scrollLeft -= SCROLL_STEP;
        else if (pointerX.current > rect.right - EDGE_PX) area.scrollLeft += SCROLL_STEP;
      }, 16);
    }
  };

  const bind = (slug: string): React.HTMLAttributes<HTMLElement> => {
    if (!enabled) return {};
    return {
      onPointerDown: (e) => {
        if (e.pointerType === "mouse" || press.current) return;
        press.current = { slug, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el: e.currentTarget };
        pointerX.current = e.clientX;
        timer.current = setTimeout(begin, LONG_PRESS_MS);
      },
      onPointerMove: (e) => {
        const p = press.current;
        if (!p || p.pointerId !== e.pointerId) return;
        pointerX.current = e.clientX;
        if (!active.current) {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_SLOP_PX) stop();
          return;
        }
        const id = columnIdAt({ x: e.clientX, y: e.clientY }, (x, y) => document.elementFromPoint(x, y));
        over.current = id;
        setOverColumnId(id);
      },
      onPointerUp: (e) => {
        const p = press.current;
        if (!p || p.pointerId !== e.pointerId) return;
        const target = active.current ? over.current : null;
        stop();
        if (target) drop.current(p.slug, target);
      },
      onPointerCancel: (e) => {
        if (press.current?.pointerId === e.pointerId) stop();
      },
      // A touch long-press can start a native drag on a draggable card; it would end this one.
      onDragStart: (e) => {
        if (press.current) e.preventDefault();
      },
      // Long-press opens the context menu on Android; it would end the drag.
      onContextMenu: (e) => {
        if (press.current) e.preventDefault();
      },
      style: draggingSlug === slug ? { touchAction: "none" } : undefined,
    };
  };

  return { bind, draggingSlug, overColumnId };
}
