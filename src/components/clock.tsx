"use client";

import { createContext, useContext, useEffect, useState } from "react";

/** The render clock; `null` outside a {@link ClockProvider}. */
const ClockContext = createContext<Date | null>(null);

/**
 * Provides the time relative dates are measured against. The server render
 * and the hydration both use `serverNow`, so "5 min ago" reads the same on
 * both sides; after hydration the clock switches to the browser's time and
 * advances every minute, keeping ages current on long-open pages.
 *
 * @param props.serverNow the request time in epoch milliseconds, taken by the root layout
 * @param props.children the app
 */
export function ClockProvider({ serverNow, children }: { serverNow: number; children: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

/** Returns the render clock's time, for comparisons with now. */
export function useNow(): Date {
  return useContext(ClockContext) ?? new Date();
}
