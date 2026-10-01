import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayName, safePath, sniffImage, uploadsDir } from "./uploads";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("sniffImage", () => {
  it("recognises one real header per type", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a\x01\x00"))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("GIF87a\x01\x00"))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
  });

  it("rejects junk, short input and an HTML file renamed .png", () => {
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(bytes(1, 2, 3))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF\x10\x00\x00\x00WAVEfmt "))).toBeNull();
  });
});

describe("safePath", () => {
  it("stays inside the directory", () => {
    const dir = path.resolve("uploads");
    expect(safePath(dir, "a.png")).toBe(path.join(dir, "a.png"));
  });

  it("throws for a key that climbs out or is absolute", () => {
    const dir = path.resolve("uploads");
    expect(() => safePath(dir, "../x")).toThrow();
    expect(() => safePath(dir, "a/../../x")).toThrow();
    expect(() => safePath(dir, path.resolve("elsewhere", "x.png"))).toThrow();
    expect(() => safePath(dir, "/etc/passwd")).toThrow();
    expect(() => safePath(dir, "")).toThrow();
  });
});

describe("displayName", () => {
  it("strips path parts, slashes and control characters", () => {
    expect(displayName("../../etc/passwd")).toBe("passwd");
    expect(displayName("..\\..\\a/b\u0000c\u001f.png")).toBe("bc.png");
    expect(displayName("  photo.png \n")).toBe("photo.png");
  });

  it("limits the length to 120 characters and falls back to a name", () => {
    expect(Array.from(displayName(`${"a".repeat(200)}.png`)).length).toBe(120);
    expect(displayName("../")).toBe("image");
  });
});

describe("uploadsDir", () => {
  it("defaults to /data/uploads and trims a given value", () => {
    expect(uploadsDir({})).toBe("/data/uploads");
    expect(uploadsDir({ EVENT_UPLOADS_DIR: " /srv/up " })).toBe("/srv/up");
  });

  it("throws when the value is empty after trimming", () => {
    expect(() => uploadsDir({ EVENT_UPLOADS_DIR: "  " })).toThrow("EVENT_UPLOADS_DIR");
  });
});
