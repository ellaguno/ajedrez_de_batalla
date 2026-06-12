import * as THREE from 'three';

/**
 * Cielos procedurales de alta resolución (4096×2048) dibujados con canvas 2D
 * en el cliente: nitidez de fondo sin descargar archivos pesados. Diseñados
 * como panoramas "flotantes": el cielo se refleja bajo el horizonte, porque
 * la cámara del juego mira hacia abajo y ve sobre todo ese hemisferio.
 */

export type SkyKind = 'atardecer' | 'noche';

const W = 4096;
const H = 2048;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pinta algo en x y duplicado en x±W para que la costura no corte nada. */
function wrapped(x: number, draw: (x: number) => void): void {
  draw(x);
  if (x < W * 0.25) draw(x + W);
  if (x > W * 0.75) draw(x - W);
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return [canvas, canvas.getContext('2d')!];
}

// ------------------------------------------------------------------- noche
function paintNight(ctx: CanvasRenderingContext2D): void {
  const r = rng(20261212);

  // Degradado simétrico (el "suelo" también es cielo).
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#04050c');
  grad.addColorStop(0.5, '#101a38');
  grad.addColorStop(1, '#04050c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Vía láctea: banda ondulada de nubes tenues.
  for (let i = 0; i < 260; i++) {
    const u = r();
    const x = u * W;
    const y = H * 0.42 + Math.sin(u * Math.PI * 2) * H * 0.16 + (r() - 0.5) * H * 0.1;
    const radius = 40 + r() * 130;
    const alpha = 0.012 + r() * 0.03;
    wrapped(x, (cx) => {
      const g = ctx.createRadialGradient(cx, y, 0, cx, y, radius);
      g.addColorStop(0, `rgba(170, 190, 230, ${alpha.toFixed(3)})`);
      g.addColorStop(1, 'rgba(170, 190, 230, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - radius, y - radius, radius * 2, radius * 2);
    });
  }

  // Estrellas nítidas; algunas brillantes con halo y tinte.
  for (let i = 0; i < 3800; i++) {
    const x = r() * W;
    const y = r() * H;
    const bright = r() < 0.1;
    const radius = bright ? 2 + r() * 2.4 : 0.7 + r() * 1.2;
    const tint = r();
    const color =
      tint < 0.12 ? '255, 225, 190' : tint < 0.24 ? '190, 210, 255' : '240, 244, 255';
    const alpha = bright ? 0.95 : 0.45 + r() * 0.5;
    if (bright) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
      g.addColorStop(0, `rgba(${color}, 0.5)`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - radius * 5, y - radius * 5, radius * 10, radius * 10);
    }
    ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Luna con cráteres y halo (en el lado visible desde la cámara inicial).
  const mx = W * 0.96;
  const my = H * 0.3;
  const mr = 46;
  wrapped(mx, (cx) => {
    const halo = ctx.createRadialGradient(cx, my, mr, cx, my, mr * 6);
    halo.addColorStop(0, 'rgba(190, 210, 255, 0.22)');
    halo.addColorStop(1, 'rgba(190, 210, 255, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - mr * 6, my - mr * 6, mr * 12, mr * 12);

    const disc = ctx.createRadialGradient(cx - mr * 0.3, my - mr * 0.3, mr * 0.2, cx, my, mr);
    disc.addColorStop(0, '#f4f7ff');
    disc.addColorStop(1, '#c9d4ea');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, my, mr, 0, Math.PI * 2);
    ctx.fill();

    const cr = rng(7);
    for (let i = 0; i < 9; i++) {
      const a = cr() * Math.PI * 2;
      const d = cr() * mr * 0.72;
      ctx.fillStyle = `rgba(150, 165, 195, ${(0.2 + cr() * 0.25).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, my + Math.sin(a) * d, 2 + cr() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// --------------------------------------------------------------- atardecer
function paintSunset(ctx: CanvasRenderingContext2D): void {
  const r = rng(4242);

  // Cielo arriba, "mar" simétrico abajo.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1c2261');
  grad.addColorStop(0.34, '#7a3a74');
  grad.addColorStop(0.47, '#e8693a');
  grad.addColorStop(0.5, '#ffb163');
  grad.addColorStop(0.53, '#d65f3c');
  grad.addColorStop(0.68, '#6a3268');
  grad.addColorStop(1, '#181d52');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Nubes alargadas iluminadas por debajo.
  for (let i = 0; i < 46; i++) {
    const x = r() * W;
    const y = H * (0.32 + r() * 0.15);
    const rw = 80 + r() * 360;
    const rh = 7 + r() * 16;
    const warm = r() < 0.6;
    const alpha = 0.05 + r() * 0.1;
    wrapped(x, (cx) => {
      const g = ctx.createRadialGradient(cx, y, 0, cx, y, rw);
      g.addColorStop(0, warm ? `rgba(255, 170, 110, ${alpha})` : `rgba(70, 50, 110, ${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(1, rh / rw);
      ctx.translate(-cx, -y);
      ctx.fillStyle = g;
      ctx.fillRect(cx - rw, y - rw, rw * 2, rw * 2);
      ctx.restore();
    });
  }

  // Sol (en la costura u=0/1: queda tras el tablero en la vista inicial).
  const sy = H * 0.47;
  wrapped(0, (cx) => {
    const glow = ctx.createRadialGradient(cx, sy, 0, cx, sy, 900);
    glow.addColorStop(0, 'rgba(255, 200, 120, 0.85)');
    glow.addColorStop(0.25, 'rgba(255, 140, 70, 0.4)');
    glow.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 900, sy - 900, 1800, 1800);

    const sun = ctx.createRadialGradient(cx, sy, 0, cx, sy, 95);
    sun.addColorStop(0, '#fffbe8');
    sun.addColorStop(0.7, '#ffd98a');
    sun.addColorStop(1, 'rgba(255, 190, 110, 0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, sy, 95, 0, Math.PI * 2);
    ctx.fill();
  });

  // Reflejo del sol: columna de destellos horizontales bajo el horizonte.
  for (let i = 0; i < 220; i++) {
    const y = H * 0.52 + r() * H * 0.4;
    const spread = 60 + (y - H * 0.5) * 0.55;
    const x = (r() - 0.5) * spread * 2;
    const len = 18 + r() * 90;
    const alpha = (0.1 + r() * 0.22) * Math.max(0.15, 1 - (y - H * 0.5) / (H * 0.45));
    wrapped(((x % W) + W) % W, (cx) => {
      ctx.fillStyle = `rgba(255, 175, 100, ${alpha.toFixed(3)})`;
      ctx.fillRect(cx - len / 2, y, len, 2.2 + r() * 2);
    });
  }

  // Rizo del agua: líneas horizontales tenues por todo el "mar".
  for (let i = 0; i < 320; i++) {
    const y = H * 0.52 + r() * H * 0.46;
    const x = r() * W;
    const len = 40 + r() * 220;
    ctx.fillStyle = `rgba(20, 24, 70, ${(0.05 + r() * 0.1).toFixed(3)})`;
    ctx.fillRect(x - len / 2, y, len, 1.6);
  }
}

const cache = new Map<SkyKind, THREE.CanvasTexture>();

export function makeSky(kind: SkyKind): THREE.CanvasTexture {
  let tex = cache.get(kind);
  if (tex) return tex;
  const [canvas, ctx] = makeCanvas();
  if (kind === 'noche') paintNight(ctx);
  else paintSunset(ctx);
  tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(kind, tex);
  return tex;
}
