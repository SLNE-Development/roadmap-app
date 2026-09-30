import { newId } from "@/lib/id";

/**
 * Returns the Valkey URL from the environment or a default local URL.
 */
export function testValkeyUrl(): string {
  return process.env.VALKEY_URL ?? "redis://localhost:6379";
}

/**
 * Returns a unique prefix for test keys to isolate each test's key space.
 */
export function uniquePrefix(): string {
  return "test:" + newId() + ":";
}
