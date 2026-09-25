import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { createRng } from '../sim/math';

/**
 * Every texture is painted at runtime on a canvas: nothing to download, works
 * offline, and the noise is periodic so every texture tiles seamlessly.
 */

// ------------------------------------------------------------ periodic noise

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1] that repeats every `period` lattice cells. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Periodic fBm over a unit square sampled at (u, v) in [0, 1). */
function pfbm(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = baseFreq;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += pnoise(u * freq, v * freq, freq, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ helpers

function canvas(w: number, h = w): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

type Rgb = [number, number, number];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Fill every pixel from a function of (u, v); much faster than fillRect per pixel. */
function paint(ctx: CanvasRenderingContext2D, w: number, h: number, fn: (u: number, v: number, out: Rgb) => void): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const px: Rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x / w, y / h, px);
      const i = (y * w + x) * 4;
      d[i] = px[0] < 0 ? 0 : px[0] > 255 ? 255 : px[0];
      d[i + 1] = px[1] < 0 ? 0 : px[1] > 255 ? 255 : px[1];
      d[i + 2] = px[2] < 0 ? 0 : px[2] > 255 ? 255 : px[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draw a stroke and its wrapped copies so strokes crossing an edge tile correctly. */
function wrapped(w: number, h: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) draw(dx, dy);
}

// ----------------------------------------------------------------- textures

export function grassTexture(size = 512): Texture {
  const { c, ctx } = canvas(size);
  const lush: Rgb = [72, 104, 44];
  const dry: Rgb = [128, 128, 66];
  const dark: Rgb = [44, 70, 30];
  paint(ctx, size, size, (u, v, out) => {
    const n = pfbm(u, v, 4, 5, 11);
    const d = pfbm(u, v, 16, 3, 23);
    let col = mix(dark, lush, n);
    col = mix(col, dry, Math.max(0, d - 0.55) * 1.4);
    const g = (hash(Math.floor(u * size), Math.floor(v * size), 5) - 0.5) * 18;
    out[0] = col[0] + g;
    out[1] = col[1] + g;
    out[2] = col[2] + g * 0.6;
  });
  // Individual blades.
  const rng = createRng(77);
  ctx.lineCap = 'round';
  for (let i = 0; i < size * 14; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 3 + rng() * 7;
    const ang = -Math.PI / 2 + (rng() - 0.5) * 1.3;
    const light = rng();
    ctx.strokeStyle = light > 0.7 ? `rgba(150,170,90,0.55)` : light > 0.35 ? `rgba(92,128,56,0.5)` : `rgba(40,64,28,0.55)`;
    ctx.lineWidth = 0.8 + rng() * 0.7;
    wrapped(size, size, (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  return toTexture(c);
}

export function dirtTexture(size = 512): Texture {
  const { c, ctx } = canvas(size);
  const a: Rgb = [112, 90, 64];
  const b: Rgb = [148, 124, 92];
  const pebble: Rgb = [170, 160, 146];
  paint(ctx, size, size, (u, v, out) => {
    const n = pfbm(u, v, 6, 5, 31);
    let col = mix(a, b, n);
    const p = pnoise(u * 64, v * 64, 64, 41);
    if (p > 0.82) col = mix(col, pebble, (p - 0.82) * 4);
    const g = (hash(Math.floor(u * size), Math.floor(v * size), 9) - 0.5) * 22;
    out[0] = col[0] + g;
    out[1] = col[1] + g;
    out[2] = col[2] + g;
  });
  return toTexture(c);
}

export function rockTexture(size = 512): Texture {
  const { c, ctx } = canvas(size);
  const a: Rgb = [96, 94, 90];
  const b: Rgb = [150, 146, 138];
  const lichen: Rgb = [120, 128, 88];
  paint(ctx, size, size, (u, v, out) => {
    const n = pfbm(u, v, 3, 6, 51);
    const cracks = Math.abs(pnoise(u * 12, v * 12, 12, 61) - 0.5) < 0.03 ? 0.55 : 1;
    let col = mix(a, b, n);
    const l = pfbm(u, v, 8, 3, 71);
    if (l > 0.6) col = mix(col, lichen, (l - 0.6) * 1.6);
    out[0] = col[0] * cracks;
    out[1] = col[1] * cracks;
    out[2] = col[2] * cracks;
  });
  return toTexture(c);
}

export function concreteTexture(size = 512, seed = 3): Texture {
  const { c, ctx } = canvas(size);
  const a: Rgb = [128, 128, 124];
  const b: Rgb = [162, 160, 154];
  const stain: Rgb = [92, 88, 82];
  paint(ctx, size, size, (u, v, out) => {
    const n = pfbm(u, v, 5, 5, seed);
    let col = mix(a, b, n);
    const s = pfbm(u, v, 2, 3, seed + 9);
    if (s > 0.58) col = mix(col, stain, Math.min((s - 0.58) * 2.5, 0.7));
    const g = (hash(Math.floor(u * size), Math.floor(v * size), seed) - 0.5) * 16;
    out[0] = col[0] + g;
    out[1] = col[1] + g;
    out[2] = col[2] + g;
  });
  // Form-work seams and cracks.
  const rng = createRng(seed * 13);
  ctx.strokeStyle = 'rgba(60,58,54,0.35)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rng() - 0.5) * 40;
      y += rng() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

/** Yard slab: concrete panels with joints, oil stains and faded paint. */
export function yardTexture(size = 1024): Texture {
  const { c, ctx } = canvas(size);
  const a: Rgb = [118, 116, 110];
  const b: Rgb = [146, 143, 136];
  const oil: Rgb = [58, 56, 54];
  paint(ctx, size, size, (u, v, out) => {
    const n = pfbm(u, v, 6, 5, 91);
    let col = mix(a, b, n);
    const s = pfbm(u, v, 3, 4, 97);
    if (s > 0.62) col = mix(col, oil, Math.min((s - 0.62) * 3, 0.8));
    const g = (hash(Math.floor(u * size), Math.floor(v * size), 99) - 0.5) * 14;
    out[0] = col[0] + g;
    out[1] = col[1] + g;
    out[2] = col[2] + g;
  });
  ctx.strokeStyle = 'rgba(52,50,46,0.55)';
  ctx.lineWidth = 3;
  const panels = 4;
  for (let i = 0; i <= panels; i++) {
    const p = (i / panels) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  return toTexture(c);
}

export function carbonTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  const cell = size / 16;
  paint(ctx, size, size, (u, v, out) => {
    const x = u * size;
    const y = v * size;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const fx = (x % cell) / cell;
    const fy = (y % cell) / cell;
    // 2x2 twill: alternate the weave direction per cell.
    const horizontal = (cx + cy) % 2 === 0;
    const t = horizontal ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    const base = 20 + t * 26 + (horizontal ? 6 : 0);
    out[0] = base;
    out[1] = base + 1;
    out[2] = base + 4;
  });
  return toTexture(c);
}

/** Grey corrugated steel; tinted per container through the material colour. */
export function corrugatedTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  paint(ctx, size, size, (u, v, out) => {
    const rib = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 16);
    const rust = pfbm(u, v, 4, 4, 121);
    let g = 150 + rib * 70;
    let r = g;
    let b = g;
    if (rust > 0.6) {
      const t = Math.min((rust - 0.6) * 2.2, 1);
      r = r * (1 - t) + 150 * t;
      g = g * (1 - t) + 92 * t;
      b = b * (1 - t) + 60 * t;
    }
    const grime = 1 - Math.max(0, v - 0.75) * 0.8;
    out[0] = r * grime;
    out[1] = g * grime;
    out[2] = b * grime;
  });
  return toTexture(c);
}

export function metalTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  paint(ctx, size, size, (u, v, out) => {
    const streak = pnoise(u * 2, v * 128, 128, 131);
    const n = pfbm(u, v, 4, 3, 133);
    const g = 120 + streak * 40 + n * 30;
    out[0] = g;
    out[1] = g;
    out[2] = g + 4;
  });
  return toTexture(c);
}

/** Chain-link mesh with transparent holes. */
export function fenceTexture(size = 128): Texture {
  const { c, ctx } = canvas(size);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(190,196,204,1)';
  ctx.lineWidth = 3;
  const step = size / 4;
  for (let i = -4; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * step + size, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
  }
  const t = toTexture(c);
  return t;
}

/** Spray-paint graffiti tags for the bando walls. */
export function graffitiTexture(seed: number, w = 512, h = 256): Texture {
  const { c, ctx } = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  const rng = createRng(seed);
  const palettes = [
    ['#f43f5e', '#fde047', '#22d3ee'],
    ['#a855f7', '#f97316', '#e5e7eb'],
    ['#22c55e', '#0ea5e9', '#f8fafc'],
    ['#facc15', '#ef4444', '#111827'],
  ];
  const pal = palettes[seed % palettes.length];
  const words = ['FPV', 'BANDO', 'SEND IT', 'RIP', 'ACRO', 'DIVE', 'QUAD', 'FREESTYLE', 'LOS'];
  const word = words[Math.floor(rng() * words.length)];

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rng() - 0.5) * 0.25);
  ctx.font = `900 ${Math.floor(h * 0.42)}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // Outline, fill and a drop shadow, like a real piece.
  ctx.lineWidth = h * 0.08;
  ctx.strokeStyle = pal[2];
  ctx.strokeText(word, 6, 8);
  ctx.fillStyle = pal[0];
  ctx.fillText(word, 0, 0);
  ctx.lineWidth = h * 0.025;
  ctx.strokeStyle = pal[1];
  ctx.strokeText(word, 0, 0);
  ctx.restore();

  // Overspray speckle.
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = pal[Math.floor(rng() * 3)];
    ctx.globalAlpha = rng() * 0.35;
    ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Racing-gate padding: coloured fabric with contrast stripes. */
export function gatePadTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  paint(ctx, size, size, (u, v, out) => {
    const weave = 0.92 + 0.08 * Math.sin(u * size * 1.5) * Math.sin(v * size * 1.5);
    const stripe = Math.floor(u * 8) % 2 === 0 ? 1 : 0.82;
    const g = 235 * weave * stripe;
    out[0] = g;
    out[1] = g;
    out[2] = g;
  });
  return toTexture(c);
}

/** Tileable white noise for the analogue video static. */
export function noiseTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  const rng = createRng(4242);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rng() * 256);
    img.data[i] = v;
    img.data[i + 1] = Math.floor(rng() * 256);
    img.data[i + 2] = Math.floor(rng() * 256);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/** Tileable normal map for small wind-driven ripples on the lake. */
export function waterNormalTexture(size = 256): Texture {
  const { c, ctx } = canvas(size);
  const height = (u: number, v: number): number => pfbm(u, v, 8, 4, 151) + 0.5 * pfbm(u, v, 20, 2, 157);
  paint(ctx, size, size, (u, v, out) => {
    const e = 1 / size;
    const dx = height(u + e, v) - height(u - e, v);
    const dy = height(u, v + e) - height(u, v - e);
    const nx = -dx * 6;
    const ny = -dy * 6;
    const nz = 1;
    const l = Math.hypot(nx, ny, nz);
    out[0] = (nx / l * 0.5 + 0.5) * 255;
    out[1] = (ny / l * 0.5 + 0.5) * 255;
    out[2] = (nz / l * 0.5 + 0.5) * 255;
  });
  return toTexture(c, false);
}
