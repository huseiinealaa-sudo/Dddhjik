import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { createRandom } from '../core/MathUtils';

/**
 * Every texture in the simulator is generated at runtime on a 2D canvas.
 * That keeps the bundle tiny (no image downloads at all), makes the whole
 * thing work offline, and means the visuals scale with the quality setting.
 */

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number, anisotropy = 8): Texture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = anisotropy;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Grass with clumps, dry patches and a hint of dirt showing through. */
export function createGrassTexture(size = 512, repeat = 90): Texture {
  const { canvas, ctx } = makeCanvas(size);
  const rand = createRandom(0x9e3779b9);

  ctx.fillStyle = '#6f8f4a';
  ctx.fillRect(0, 0, size, size);

  // Broad tonal variation. These stay light on purpose: this canvas is the
  // albedo, and an albedo that is already dark leaves nothing for the lighting
  // to work with — the ground just turns black.
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 70;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand();
    const colour =
      tone > 0.72 ? '146,170,92' : tone > 0.42 ? '99,130,62' : tone > 0.18 ? '122,150,74' : '156,148,84';
    gradient.addColorStop(0, `rgba(${colour},0.55)`);
    gradient.addColorStop(1, `rgba(${colour},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Individual blades for close-up detail.
  ctx.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 2 + rand() * 5;
    const angle = rand() * Math.PI * 2;
    const light = 56 + rand() * 68;
    ctx.strokeStyle = `rgba(${Math.round(light * 1.05)},${Math.round(light * 1.5)},${Math.round(light * 0.7)},0.55)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  return finish(canvas, repeat, 16);
}

/** Weathered concrete for the launch pad and the buildings. */
export function createConcreteTexture(size = 512, repeat = 4): Texture {
  const { canvas, ctx } = makeCanvas(size);
  const rand = createRandom(0x51ed270b);

  ctx.fillStyle = '#9a9ea4';
  ctx.fillRect(0, 0, size, size);

  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 52;
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }
  ctx.putImageData(image, 0, 0);

  // Stains and cracks.
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(60,62,68,${0.08 + rand() * 0.16})`;
    ctx.lineWidth = 0.6 + rand() * 1.6;
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (rand() - 0.5) * 90;
      y += (rand() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Expansion joints.
  ctx.strokeStyle = 'rgba(52,54,60,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);

  return finish(canvas, repeat);
}

/** Corrugated painted steel for shipping containers. */
export function createContainerTexture(colour: string, size = 256, repeat = 1): Texture {
  const { canvas, ctx } = makeCanvas(size);
  const rand = createRandom(0x1a2b3c4d);

  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, size, size);

  // Vertical corrugation.
  for (let x = 0; x < size; x += 10) {
    const shade = ctx.createLinearGradient(x, 0, x + 10, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.28)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    shade.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, 0, 10, size);
  }

  // Rust and scuffs.
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 9;
    ctx.fillStyle = `rgba(${90 + rand() * 60},${45 + rand() * 30},${20 + rand() * 20},${0.05 + rand() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Top and bottom rails.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, size, 9);
  ctx.fillRect(0, size - 9, size, 9);

  return finish(canvas, repeat);
}

/** High-visibility hazard stripes for the gates and barriers. */
export function createHazardTexture(size = 128, repeat = 1): Texture {
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#f5b301';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#141414';
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  for (let i = -size; i < size; i += 32) {
    ctx.fillRect(i, -size, 16, size * 2);
  }
  ctx.restore();
  return finish(canvas, repeat, 4);
}

/** Simple noise texture reused by the analogue-video post effect. */
export function createNoiseTexture(size = 256): Texture {
  const { canvas, ctx } = makeCanvas(size);
  const image = ctx.createImageData(size, size);
  const rand = createRandom(0x2545f491);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
