"use client";

import { useState } from "react";
import { addDays, dayTicks, linearScale, niceTicks } from "@/lib/chart/scale";
import type { BurnupPoint, Projection } from "@/lib/insight/burnup";

const HEIGHT = 220;
const MARGIN = { left: 34, right: 14, top: 12, bottom: 26 };
const DAY_MS = 86_400_000;
const LABEL = "fill-muted-foreground text-[10.5px]";

/** The label "2 Sep" of a UTC day key. */
function dayName(key: string): string {
  return dayTicks([key], 1)[0].label;
}

/**
 * The task burn-up: scope and done per UTC day, with the projected finish as a
 * triangle from today's done count to the scope line. Hovering a day shows its
 * numbers; the hidden table gives the same numbers to keyboard and screen
 * reader users.
 *
 * @param props.points one point per day, oldest first
 * @param props.projection the projected finish
 * @param props.width the width of the viewBox, 560 by default
 */
export function BurnupChart({ points, projection, width = 560 }: { points: BurnupPoint[]; projection: Projection; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1);
  if (!last) return null;
  const range = projection.status === "range" ? projection : null;
  const extraDays = range ? Math.max(0, Math.round((Date.parse(`${range.latest}T00:00:00Z`) - Date.parse(`${last.day}T00:00:00Z`)) / DAY_MS)) : 0;
  const lastIndex = points.length - 1;
  const span = lastIndex + extraDays;
  const maxScope = Math.max(...points.map((p) => p.scope));
  const yTicks = niceTicks(maxScope);
  const x = linearScale([0, span], [MARGIN.left, width - MARGIN.right]);
  const y = linearScale([0, yTicks.at(-1)!], [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const baseline = y(0);
  const keys = [...points.map((p) => p.day), ...Array.from({ length: extraDays }, (_, i) => addDays(last.day, i + 1))];
  const line = (pick: (p: BurnupPoint) => number) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(pick(p))}`).join(" ");
  const band = (width - MARGIN.left - MARGIN.right) / Math.max(1, span);
  const earliestX = range ? x(lastIndex + Math.round((Date.parse(`${range.earliest}T00:00:00Z`) - Date.parse(`${last.day}T00:00:00Z`)) / DAY_MS)) : 0;
  const shown = hover === null ? null : points[hover];
  const summary = `Burn-up over ${points.length} days: done ${last.done} of ${last.scope} tasks`;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={summary} className="h-auto w-full">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={MARGIN.left - 6} y={y(t) + 3.5} textAnchor="end" className={LABEL}>
              {t}
            </text>
          </g>
        ))}
        {dayTicks(keys).map((t) => (
          <text key={t.index} x={x(t.index)} y={HEIGHT - 8} textAnchor={t.index === 0 ? "start" : t.index === span ? "end" : "middle"} className={LABEL}>
            {t.label}
          </text>
        ))}
        <path d={`${line((p) => p.done)} L${x(lastIndex)} ${baseline} L${x(0)} ${baseline} Z`} className="fill-primary/10" />
        <path d={line((p) => p.scope)} className="fill-none stroke-muted-foreground" strokeWidth={1.75} />
        <path d={line((p) => p.done)} className="fill-none stroke-primary" strokeWidth={2.25} />
        <line x1={x(lastIndex)} x2={x(lastIndex)} y1={MARGIN.top} y2={baseline} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
        {range && (
          <>
            <polygon points={`${x(lastIndex)},${y(last.done)} ${earliestX},${y(last.scope)} ${x(span)},${y(last.scope)}`} className="fill-primary/15" />
            <line x1={x(lastIndex)} x2={x(span)} y1={y(last.scope)} y2={y(last.scope)} className="stroke-muted-foreground" strokeWidth={1.75} strokeDasharray="4 3" />
          </>
        )}
        {shown && hover !== null && (
          <g aria-hidden pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={baseline} className="stroke-muted-foreground" strokeWidth={1} />
            <g transform={`translate(${Math.min(x(hover) + 8, width - MARGIN.right - 96)} ${MARGIN.top})`}>
              <rect width={96} height={46} className="fill-popover stroke-border" />
              <text x={8} y={14} className="fill-foreground text-[11px] font-semibold">
                {dayName(shown.day)}
              </text>
              <text x={8} y={28} className={LABEL}>
                Scope {shown.scope}
              </text>
              <text x={8} y={40} className={LABEL}>
                Done {shown.done}
              </text>
            </g>
          </g>
        )}
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - band / 2}
            y={MARGIN.top}
            width={band}
            height={baseline - MARGIN.top}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-primary" />
          Done
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-muted-foreground" />
          Scope
        </span>
        {range && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 bg-primary/15" />
            Projected finish
          </span>
        )}
        <span className="text-muted-foreground">Days in UTC</span>
      </figcaption>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Scope</th>
            <th scope="col">Done</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{dayName(p.day)}</td>
              <td>{p.scope}</td>
              <td>{p.done}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
