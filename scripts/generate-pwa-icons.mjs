// Generates the PWA icon system from the master pear mark (see the icon spec
// in the mobile build plan). Outputs:
//   app/icon.svg              — pear mark, served as the modern favicon
//   public/icon-192.png       — manifest icon (small)
//   public/icon-512.png       — manifest icon (large)
//   public/icon-512-maskable.png — Android maskable (mark inside the 80%-diameter
//                                  safe circle; background bleeds to the edges)
//   app/apple-icon.png        — 180x180 iOS home-screen icon (auto-linked by Next)
//   public/favicon.ico        — "p" wordmark at 16+32 (the pear loses detail at
//                               tab size; the mono "p" stays legible)
//
// Run: node scripts/generate-pwa-icons.mjs
// (sharp comes in via Next's dependency tree — no direct dependency needed)
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const BG = "#0a0a0a";
const FILL = "#f2ede4";

// The pear mark in a 260x360 design box: geometric silhouette (neck at the
// top, widest at y=288) with a single leaf angled up-left. No stem detail.
const MARK = `
  <path fill="${FILL}" d="M130,64
    C117,64 107,76 103,94
    C97,126 85,158 66,186
    C42,220 26,250 26,288
    C26,326 70,356 130,356
    C190,356 234,326 234,288
    C234,250 218,220 194,186
    C175,158 163,126 157,94
    C153,76 143,64 130,64 Z"/>
  <path fill="${FILL}" d="M136,60
    C118,20 84,2 52,10
    C58,44 92,66 132,64 Z"/>
`;

// Mark centered on a 512 canvas at the given scale (mark box center: 130,182).
const pearSvg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256,256) scale(${scale}) translate(-130,-182)">${MARK}</g>
</svg>`;

// Lowercase mono "p" for the legacy favicon (JetBrains Mono voice; Menlo is
// the macOS fallback fontconfig actually resolves at generation time).
const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <text x="256" y="272" font-family="JetBrains Mono, Menlo, monospace" font-size="400"
    font-weight="700" fill="${FILL}" text-anchor="middle" dominant-baseline="central">p</text>
</svg>`;

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

// Minimal ICO container with embedded PNGs (accepted by every modern browser).
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * images.length;
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit depth
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
    blobs.push(buf);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const root = new URL("..", import.meta.url).pathname;

await writeFile(`${root}app/icon.svg`, pearSvg(0.95) + "\n");
await writeFile(`${root}public/icon-192.png`, await png(pearSvg(0.95), 192));
await writeFile(`${root}public/icon-512.png`, await png(pearSvg(0.95), 512));
// Safe zone: content must survive a circular crop of 80% diameter (r=205 on
// 512). Mark half-diagonal at 0.78 ≈ 158px — comfortably inside.
await writeFile(
  `${root}public/icon-512-maskable.png`,
  await png(pearSvg(0.78), 512)
);
await writeFile(`${root}app/apple-icon.png`, await png(pearSvg(0.85), 180));
await writeFile(
  `${root}public/favicon.ico`,
  ico([
    { size: 16, buf: await png(wordmarkSvg, 16) },
    { size: 32, buf: await png(wordmarkSvg, 32) },
  ])
);
console.log("PWA icons generated.");
