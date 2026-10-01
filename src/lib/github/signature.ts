import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

/** Returns GitHub's `X-Hub-Signature-256` value for `body`: `sha256=<hex HMAC-SHA256>`. */
export function signBody(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Whether `header` is a `sha256=` signature of the raw `body` with any of `secrets`, compared in constant time.
 * `sha1=` signatures and uppercase hex are rejected.
 */
export function verifySignature(secrets: string[], body: Buffer | string, header: string | null): boolean {
  const match = SIGNATURE.exec(header ?? "");
  if (!match) return false;
  const given = Buffer.from(match[1], "utf8");
  for (const secret of secrets) {
    const expected = Buffer.from(signBody(secret, body).slice("sha256=".length), "utf8");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
