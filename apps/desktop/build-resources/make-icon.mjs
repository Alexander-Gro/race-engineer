// Generate the app icon — a steering-wheel mark on a carbon tile — with zero external tools (pure
// Node + zlib). Renders at 4× and box-downsamples for clean anti-aliasing, encodes a 256×256 RGBA
// PNG, and wraps it in a PNG-backed .ico (Vista+). Committed + reproducible: `node build-resources/make-icon.mjs`.
// Writes icon.ico (electron-builder's app + installer icon) + icon.png (general use) next to this script.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const SS = 4; // supersample factor for anti-aliasing
const W = SIZE * SS;
const H = SIZE * SS;

// --- palette ---------------------------------------------------------------
const CARBON_TOP = [0x18, 0x1e, 0x29];
const CARBON_BOT = [0x0a, 0x0d, 0x12];
const RIM = [0xe6, 0x2a, 0x2a]; // F1-ish red wheel
const HUB = [0xff, 0x6b, 0x4a]; // a touch lighter at the centre, for depth

// --- geometry (in supersampled coords) -------------------------------------
const cx = W / 2;
const cy = H / 2;
const cornerR = 52 * SS; // tile corner radius
const Rout = 94 * SS; // wheel outer radius
const Rin = 78 * SS; // wheel rim inner radius
const hubR = 24 * SS; // centre hub radius
const hw = 12 * SS; // spoke half-width

const lerp = (a, b, t) => a + (b - a) * t;

const insideTile = (x, y) => {
  const rr = cornerR;
  let dx = 0;
  let dy = 0;
  if (x < rr && y < rr) {
    dx = rr - x;
    dy = rr - y;
  } else if (x > W - rr && y < rr) {
    dx = x - (W - rr);
    dy = rr - y;
  } else if (x < rr && y > H - rr) {
    dx = rr - x;
    dy = y - (H - rr);
  } else if (x > W - rr && y > H - rr) {
    dx = x - (W - rr);
    dy = y - (H - rr);
  } else {
    return true;
  }
  return dx * dx + dy * dy <= rr * rr;
};

// Returns the wheel colour at a point, or null if not on the wheel.
const wheelColor = (x, y) => {
  const px = x - cx;
  const py = y - cy;
  const r = Math.hypot(px, py);
  if (r <= hubR) return HUB; // centre hub
  if (r >= Rin && r <= Rout) return RIM; // outer rim (annulus)
  // spokes: a horizontal bar (left+right) and a downward stem, inside the rim
  if (r < Rin) {
    const horizontal = Math.abs(py) <= hw && Math.abs(px) <= Rin;
    const stem = Math.abs(px) <= hw && py >= 0 && py <= Rin;
    if (horizontal || stem) return RIM;
  }
  return null;
};

// Colour (RGBA) at a supersample coordinate.
const sampleAt = (x, y) => {
  if (!insideTile(x, y)) return [0, 0, 0, 0]; // transparent outside the rounded tile
  const t = y / H;
  const bg = [
    Math.round(lerp(CARBON_TOP[0], CARBON_BOT[0], t)),
    Math.round(lerp(CARBON_TOP[1], CARBON_BOT[1], t)),
    Math.round(lerp(CARBON_TOP[2], CARBON_BOT[2], t)),
  ];
  const w = wheelColor(x, y);
  const c = w ?? bg;
  return [c[0], c[1], c[2], 255];
};

// --- render with box downsample -------------------------------------------
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0; // sum of alpha (0..255) across samples
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const [sr, sg, sb, sa] = sampleAt(px * SS + sx + 0.5, py * SS + sy + 0.5);
        const af = sa / 255; // premultiply so edges blend correctly against transparency
        r += sr * af;
        g += sg * af;
        b += sb * af;
        a += sa;
      }
    }
    const n = SS * SS;
    const i = (py * SIZE + px) * 4;
    if (a > 0) {
      // alpha-weighted average colour: (Σ c·α) / (Σ α)
      rgba[i] = Math.round((r * 255) / a);
      rgba[i + 1] = Math.round((g * 255) / a);
      rgba[i + 2] = Math.round((b * 255) / a);
      rgba[i + 3] = Math.round(a / n);
    } else {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
    }
  }
}

// --- PNG encode ------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const encodePng = (width, height, pixels) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// --- ICO wrap (single 256×256 PNG entry; width/height byte 0 ⇒ 256) --------
const encodeIco = (png) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256
  entry[1] = 0; // height 256
  entry[2] = 0; // colours
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // bytes
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png]);
};

const png = encodePng(SIZE, SIZE, rgba);
const dir = fileURLToPath(new URL('.', import.meta.url));
writeFileSync(dir + 'icon.png', png);
writeFileSync(dir + 'icon.ico', encodeIco(png));
console.log(`wrote icon.png (${png.length}B) + icon.ico (${png.length + 22}B) in ${dir}`);
