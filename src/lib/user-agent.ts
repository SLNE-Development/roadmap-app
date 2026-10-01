/** The browser and operating system of a user agent; both null when it is missing or not a known browser. */
export interface DescribedUserAgent {
  browser: string | null;
  system: string | null;
}

/** Splits a browser's user agent into its browser and system, or nulls when it is missing or not a known browser. */
export function parseUserAgent(ua: string | null): DescribedUserAgent {
  if (!ua) return { browser: null, system: null };
  const browser = /Claude\//.test(ua)
    ? "Claude desktop"
    : /Edg\//.test(ua)
      ? "Edge"
      : /CriOS/.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (!browser) return { browser: null, system: null };
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Macintosh|Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux|X11/.test(ua)
              ? "Linux"
              : null;
  return { browser, system };
}

/** An English label such as "Chrome on Windows", or "Unknown device"; stored with push subscriptions, never shown translated. */
export function describeUserAgent(ua: string | null): string {
  const { browser, system } = parseUserAgent(ua);
  if (!browser) return "Unknown device";
  return system ? `${browser} on ${system}` : browser;
}
