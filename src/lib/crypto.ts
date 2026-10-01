import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Reads the AES-256 key from `ENCRYPTION_KEY`.
 *
 * @throws Error naming the variable when it is missing or not 32 bytes after base64 decoding
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set; see .env.example.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes in base64; generate one with: openssl rand -base64 32");
  return buf;
}

/**
 * Checks `ENCRYPTION_KEY` once at start, so a malformed key stops the process before it serves anything.
 *
 * @throws Error naming the variable when it is missing or not 32 bytes after base64 decoding
 */
export function checkEncryptionKey(): void {
  key();
}

/**
 * Encrypts a secret such as a webhook URL with AES-256-GCM and a random 12-byte iv.
 *
 * @returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url
 * @throws Error when `ENCRYPTION_KEY` is missing or not 32 bytes
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/**
 * Decrypts a value made by {@link encryptSecret}.
 *
 * @throws Error("Cannot decrypt secret") when the value is malformed, tampered with or was encrypted with another key
 */
export function decryptSecret(value: string): string {
  const k = key();
  const [version, iv, tag, data, ...rest] = value.split(".");
  if (version !== "v1" || iv === undefined || tag === undefined || data === undefined || rest.length > 0) throw new Error("Cannot decrypt secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Cannot decrypt secret");
  }
}
