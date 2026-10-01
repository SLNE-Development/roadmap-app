"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { addDays, dayTicks, linearScale, niceTicks } from "@/lib/chart/scale";
import type { BurnupPoint, Projection } from "@/lib/insight/burnup";

const HEIGHT = 220;
const MARGIN = { left: 34, right: 14, top: 12, bottom: 26 };
const DAY_MS = 86_400_000;
const LABEL = "fill-muted-foreground text-[10.5px]";

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
  const t = useTranslations("insight.burnup");
  const format = useFormatter();
  /** The label "2 Sep" of a UTC day key, in the same day for every time zone. */
  const dayName = (key: string) => format.dateTime(new Date(`${key}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1);
  if (!last) return null;
  const range = projection.status === "range" ? projection : null;
  const daysFromLast = (key: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${last.day}T00:00:00Z`)) / DAY_MS);
  const latestDays = range ? Math.max(0, daysFromLast(range.latest)) : 0;
  // A slow pace would squash the history, so the projection is clipped at the right edge.
  const extraDays = Math.min(latestDays, Math.max(14, points.length));
  const clipped = latestDays > extraDays;
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
  // The triangle from today's done count to the earliest and latest finish on the scope line, cut at the right edge.
  const projectionPoints = (r: { earliest: string; latest: string }) => {
    const [early, late] = [r.earliest, r.latest].map((k) => lastIndex + daysFromLast(k));
    const rise = last.scope - last.done;
    const cut = (target: number) => y(last.done + (rise * (span - lastIndex)) / (target - lastIndex));
    const pts: [number, number][] = [[lastIndex, y(last.done)]];
    if (early > span) pts.push([span, cut(early)]);
    else pts.push([early, y(last.scope)]);
    if (late <= span) pts.push([late, y(last.scope)]);
    else {
      if (early <= span) pts.push([span, y(last.scope)]);
      pts.push([span, cut(late)]);
    }
    return pts.map(([i, py]) => `${x(i)},${py}`).join(" ");
  };
  const shown = hover === null ? null : points[hover];
  const summary = t("summary", { days: points.length, done: last.done, scope: last.scope });

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
        {dayTicks(keys).map((tick) => (
          <text key={tick.index} x={x(tick.index)} y={HEIGHT - 8} textAnchor={tick.index === 0 ? "start" : tick.index === span ? "end" : "middle"} className={LABEL}>
            {dayName(keys[tick.index])}
          </text>
        ))}
        <path d={`${line((p) => p.done)} L${x(lastIndex)} ${baseline} L${x(0)} ${baseline} Z`} className="fill-primary/10" />
        <path d={line((p) => p.scope)} className="fill-none stroke-muted-foreground" strokeWidth={1.75} />
        <path d={line((p) => p.done)} className="fill-none stroke-primary" strokeWidth={2.25} />
        <line x1={x(lastIndex)} x2={x(lastIndex)} y1={MARGIN.top} y2={baseline} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
        {range && (
          <>
            <polygon points={projectionPoints(range)} className="fill-primary/15" />
            <line x1={x(lastIndex)} x2={x(span)} y1={y(last.scope)} y2={y(last.scope)} className="stroke-muted-foreground" strokeWidth={1.75} strokeDasharray="4 3" />
            {clipped && (
              <text x={x(span)} y={y(last.scope) - 5} textAnchor="end" className={LABEL}>
                {`→ ${dayName(range.latest)}`}
              </text>
            )}
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
                {t("tooltipScope", { value: shown.scope })}
              </text>
              <text x={8} y={40} className={LABEL}>
                {t("tooltipDone", { value: shown.done })}
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
          {t("done")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-muted-foreground" />
          {t("scope")}
        </span>
        {range && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 bg-primary/15" />
            {t("projected")}
          </span>
        )}
        <span className="text-muted-foreground">{t("daysInUtc")}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{t("day")}</th>
            <th scope="col">{t("scope")}</th>
            <th scope="col">{t("done")}</th>
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
