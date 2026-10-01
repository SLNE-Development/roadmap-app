/** Describes a browser's user agent as "Browser on System", or "Unknown device" when it is missing or not a known browser. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
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
  if (!browser) return "Unknown device";
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
  return system ? `${browser} on ${system}` : browser;
}
