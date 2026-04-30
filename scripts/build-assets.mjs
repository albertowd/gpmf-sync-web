#!/usr/bin/env node
// One-shot generator for public/favicon.ico + public/preview.webp.
// Sources live in scripts/assets/ so the originals don't ship with the
// built site. Re-run after replacing either source PNG.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "assets");
const OUT = resolve(HERE, "..", "public");

const FAVICON_SIZES = [16, 32, 48, 64];

async function buildFavicon() {
  const src = resolve(SRC, "favicon.png");
  const buffers = await Promise.all(
    FAVICON_SIZES.map((size) =>
      sharp(src).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer(),
    ),
  );
  const ico = await pngToIco(buffers);
  const out = resolve(OUT, "favicon.ico");
  writeFileSync(out, ico);
  console.log(`favicon.ico  ${ico.byteLength} B  (sizes ${FAVICON_SIZES.join("/")})`);
}

async function buildPreview() {
  const src = resolve(SRC, "preview.png");
  const out = resolve(OUT, "preview.webp");
  const info = await sharp(src).webp({ quality: 82, effort: 6 }).toFile(out);
  console.log(`preview.webp ${info.size} B  (${info.width}x${info.height})`);
}

await Promise.all([buildFavicon(), buildPreview()]);
