import * as THREE from 'three';

/**
 * Texturas procedurales (canvas 2D). Se generan en tonos claros y se tiñen
 * multiplicativamente con material.color, así los colores del set de piezas
 * siguen mandando sobre el aspecto final.
 */

/** PRNG determinista (mulberry32) para texturas reproducibles. */
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

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return [canvas, canvas.getContext('2d')!];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Madera con vetas onduladas, algún nudo y moteado fino. */
export function woodTexture(seed = 1, size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const r = rng(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Vetas: líneas verticales onduladas de opacidad y grosor variables.
  for (let i = 0; i < 46; i++) {
    const x0 = r() * size;
    const amp = 3 + r() * 9;
    const freq = (0.6 + r() * 1.6) / size;
    const phase = r() * Math.PI * 2;
    const alpha = 0.05 + r() * 0.11;
    ctx.strokeStyle = `rgba(92, 52, 20, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 0.6 + r() * 2.4;
    ctx.beginPath();
    for (let y = 0; y <= size; y += 4) {
      const x =
        x0 +
        Math.sin(y * freq * Math.PI * 2 + phase) * amp +
        Math.sin(y * 0.11 + phase * 3) * 1.6;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Nudos ocasionales: elipses concéntricas.
  const knots = r() < 0.5 ? 1 : r() < 0.8 ? 2 : 0;
  for (let k = 0; k < knots; k++) {
    const cx = size * (0.15 + r() * 0.7);
    const cy = size * (0.15 + r() * 0.7);
    for (let ring = 6; ring >= 1; ring--) {
      ctx.strokeStyle = `rgba(80, 42, 16, ${(0.05 + r() * 0.06).toFixed(3)})`;
      ctx.lineWidth = 1 + r();
      ctx.beginPath();
      ctx.ellipse(cx, cy, ring * (2.4 + r() * 2), ring * (3.6 + r() * 3), r() * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Moteado fino para romper la uniformidad.
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(70, 40, 18, ${(0.02 + r() * 0.05).toFixed(3)})`;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 1.5);
  }

  return toTexture(canvas);
}

/** Piedra clara con manchas suaves y juntas de sillería. */
export function stoneTexture(seed = 7, size = 256, joints = true): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const r = rng(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Manchas suaves superpuestas.
  for (let i = 0; i < 240; i++) {
    const radius = 4 + r() * 26;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    const a = 0.025 + r() * 0.05;
    g.addColorStop(0, `rgba(95, 92, 88, ${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(95, 92, 88, 0)');
    ctx.save();
    ctx.translate(r() * size, r() * size);
    ctx.fillStyle = g;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  if (joints) {
    // Juntas de bloques (sillería) con hiladas alternas.
    ctx.strokeStyle = 'rgba(60, 58, 55, 0.30)';
    ctx.lineWidth = 2;
    const rows = 4;
    const rowH = size / rows;
    for (let row = 0; row <= rows; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * rowH);
      ctx.lineTo(size, row * rowH);
      ctx.stroke();
    }
    for (let row = 0; row < rows; row++) {
      const offset = (row % 2) * (size / 6);
      for (let c = 0; c < 3; c++) {
        const x = ((c * size) / 3 + offset) % size;
        ctx.beginPath();
        ctx.moveTo(x, row * rowH);
        ctx.lineTo(x, (row + 1) * rowH);
        ctx.stroke();
      }
    }
  }

  return toTexture(canvas);
}
