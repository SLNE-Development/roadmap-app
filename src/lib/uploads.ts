import path from "node:path";
import { UPLOAD_LIMITS } from "./upload-limits";

export { UPLOAD_LIMITS };

/** An image type the app stores. */
export type ImageType = (typeof UPLOAD_LIMITS.types)[number];

/** The file extension of each stored type. */
export const IMAGE_EXTENSIONS: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

const DEFAULT_UPLOADS_DIR = "/data/uploads";

/**
 * The directory uploaded images live in: `EVENT_UPLOADS_DIR`, `/data/uploads` when unset.
 *
 * @throws Error when the variable is set but empty after trimming
 */
export function uploadsDir(env: Record<string, string | undefined> = process.env): string {
  const value = (env.EVENT_UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR).trim();
  if (!value) throw new Error("EVENT_UPLOADS_DIR is empty; set it to a directory or unset it.");
  return value;
}

/** Returns whether `bytes` starts with `head` at `offset`. */
function startsWith(bytes: Uint8Array, head: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + head.length && head.every((b, i) => bytes[offset + i] === b);
}

/** Returns the image type the magic bytes show, or null when it is none of the allowed ones. The declared type is never used. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/**
 * Joins `storageKey` onto `dir` and verifies the result stays inside it.
 *
 * @throws Error when the key is absolute or climbs out of the directory
 */
export function safePath(dir: string, storageKey: string): string {
  const root = path.resolve(dir);
  const full = path.resolve(root, storageKey);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.isAbsolute(storageKey)) throw new Error("Invalid storage key.");
  return full;
}

/** Returns a file name fit to show and to put in a header: path parts, control characters and surrounding blanks removed, at most 120 characters. */
export function displayName(name: string): string {
  const last = name.replaceAll("\\", "/").split("/").pop() ?? "";
  const clean = last.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "").trim();
  return Array.from(clean).slice(0, 120).join("") || "image";
}
