/**
 * Renders the raster icons from `src/app/icon.svg`: the Apple touch icon, the favicon
 * and the web app manifest icons. Run after changing the SVG: `node scripts/generate-icons.mjs`.
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../src/app/icon.svg", import.meta.url));

/** Renders the icon as a square PNG of the given size. */
const png = (size) => sharp(svg, { density: 72 * (size / 32) * 2 }).resize(size, size).png().toBuffer();

/** Packs PNG images into one `.ico` file (PNG-compressed entries). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const out = (path) => new URL(`../${path}`, import.meta.url);

await writeFile(out("src/app/apple-icon.png"), await png(180));
await writeFile(out("public/icon-192.png"), await png(192));
await writeFile(out("public/icon-512.png"), await png(512));
await writeFile(out("src/app/favicon.ico"), ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })))));
