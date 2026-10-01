/** What an upload may be. A banner uses the same limits; 8 MiB is Discord's attachment limit at the lowest tier. */
export const UPLOAD_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  maxPerRequest: 40,
} as const;
