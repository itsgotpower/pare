// Generates the PWA icon system from the master pear mark (see the icon spec
// in the mobile build plan). Outputs:
//   public/icon-source.svg    — shareable 512 master (reference copy)
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
const FILL = "#F5F1E8";

// The pear mark, authored directly in the 512 canvas. Two-lobe geometric
// silhouette: a small tapered top lobe, a clear waist (the tangents are
// vertical at the pinch, so each side is a smooth S-curve, not a corner), and
// a weighty bottom lobe (~280 wide vs the top's ~156). Bounding box x[116,396]
// y[58,478]; visual centre (256,268). A single fat almond leaf angles up-right
// ~35 and overlaps the neck so it reads as attached, not floating. No stem.
const MARK = `
  <path fill="${FILL}" d="M256,120
    C282,122 334,150 334,210
    C334,244 328,258 328,282
    C328,312 396,330 396,392
    C396,446 332,478 256,478
    C180,478 116,446 116,392
    C116,330 184,312 184,282
    C184,258 178,244 178,210
    C178,150 230,122 256,120 Z"/>
  <path fill="${FILL}" d="M250,132
    C293,131 326,101 332,58
    C289,59 256,89 250,132 Z"/>
`;

// Scale the mark about its visual centre (256,268), keeping it centred on the
// canvas. scale=1.0 is the full composition (built-in ~46px margins top/bottom).
const pearSvg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256,256) scale(${scale}) translate(-256,-268)">${MARK}</g>
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

// Shareable 512 master (full composition) — reference copy, not wired into the
// app; edit this script (the mark master), never the emitted assets.
await writeFile(`${root}public/icon-source.svg`, pearSvg(1.0) + "\n");
await writeFile(`${root}app/icon.svg`, pearSvg(1.0) + "\n");
await writeFile(`${root}public/icon-192.png`, await png(pearSvg(1.0), 192));
await writeFile(`${root}public/icon-512.png`, await png(pearSvg(1.0), 512));
// Safe zone: content must survive a circular crop of 80% diameter (r=205 on
// 512). At 0.80 the mark's max radius (leaf tip, ~223 at s=1) is ~178px —
// comfortably inside the safe circle.
await writeFile(
  `${root}public/icon-512-maskable.png`,
  await png(pearSvg(0.8), 512)
);
await writeFile(`${root}app/apple-icon.png`, await png(pearSvg(0.9), 180));
await writeFile(
  `${root}public/favicon.ico`,
  ico([
    { size: 16, buf: await png(wordmarkSvg, 16) },
    { size: 32, buf: await png(wordmarkSvg, 32) },
  ])
);
console.log("PWA icons generated.");
