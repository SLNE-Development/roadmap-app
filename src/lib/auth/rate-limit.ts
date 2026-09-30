/** Per-key request limit of the API key plugin: at most `maxRequests` verifications per `timeWindow` milliseconds. */
export const API_KEY_RATE_LIMIT = { timeWindow: 60_000, maxRequests: 600 } as const;

/** The failure part of a `verifyApiKey` result, as far as rate limiting is concerned. */
export interface VerificationError {
  code?: string;
  details?: unknown;
}

/** An API key is valid but has used up its rate limit; adapters respond 429. */
export class ApiKeyRateLimitedError extends Error {
  /** @param retryAfterSeconds whole seconds until the key may be used again, or `null` when unknown */
  constructor(readonly retryAfterSeconds: number | null) {
    const retry = retryAfterSeconds === null ? "Retry shortly." : `Retry in ${retryAfterSeconds} s.`;
    super(`API key rate limit exceeded: at most ${API_KEY_RATE_LIMIT.maxRequests} requests per ${windowText()}. ${retry}`);
    this.name = new.target.name;
  }
}

/** Describes the configured window in words: "minute" for 60 s, otherwise the seconds. */
function windowText(): string {
  const seconds = API_KEY_RATE_LIMIT.timeWindow / 1000;
  return seconds === 60 ? "minute" : `${seconds} s`;
}

/**
 * Returns the rate-limit error for a failed verification, or `null` when it failed for
 * another reason. The plugin reports a rate limit with code `RATE_LIMITED` and
 * `details.tryAgainIn` in milliseconds.
 */
export function rateLimitOf(error: VerificationError | null | undefined): ApiKeyRateLimitedError | null {
  if (error?.code !== "RATE_LIMITED") return null;
  const tryAgainIn = (error.details as { tryAgainIn?: unknown } | undefined)?.tryAgainIn;
  const seconds = typeof tryAgainIn === "number" && Number.isFinite(tryAgainIn) ? Math.max(1, Math.ceil(tryAgainIn / 1000)) : null;
  return new ApiKeyRateLimitedError(seconds);
}

/** Builds the 429 response for a rate-limited key, with `Retry-After` when the wait is known. */
export function rateLimitedResponse(error: ApiKeyRateLimitedError): Response {
  const headers: Record<string, string> = error.retryAfterSeconds === null ? {} : { "Retry-After": String(error.retryAfterSeconds) };
  return Response.json({ error: error.message }, { status: 429, headers });
}
