/**
 * Genera fondos HDRI equirectangulares procedurales en formato Radiance
 * (.hdr, RGBE sin compresión): un atardecer y una noche estrellada.
 * Salida: client/public/hdri/*.hdr + index.json.
 *
 * Uso: node client/scripts/generate-hdri.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'hdri');
mkdirSync(OUT, { recursive: true });

const W = 1024;
const H = 512;

/** Codifica un color lineal HDR a RGBE. */
function encodeRgbe(r, g, b, out, o) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  let e = Math.ceil(Math.log2(v));
  let f = v / 2 ** e;
  if (f > 1) {
    f /= 2;
    e++;
  }
  if (f <= 0.5) {
    f *= 2;
    e--;
  }
  const scale = 256 / 2 ** e;
  out[o] = Math.min(255, Math.round(r * scale));
  out[o + 1] = Math.min(255, Math.round(g * scale));
  out[o + 2] = Math.min(255, Math.round(b * scale));
  out[o + 3] = e + 128;
}

function writeHdr(name, pixelFn) {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixelFn(x / W, y / H);
      encodeRgbe(r, g, b, data, (y * W + x) * 4);
    }
  }
  const header = `#?RADIANCE\nGENERADOR=ajedrez-de-batalla\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`;
  writeFileSync(join(OUT, name), Buffer.concat([Buffer.from(header, 'ascii'), data]));
  console.log(`[generate-hdri] ${name} (${((header.length + data.length) / 1024 / 1024).toFixed(1)} MB)`);
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Distancia angular entre dos direcciones esféricas (θ polar, φ azimut). */
function angDist(theta1, phi1, theta2, phi2) {
  const dot =
    Math.sin(theta1) * Math.sin(theta2) * Math.cos(phi1 - phi2) +
    Math.cos(theta1) * Math.cos(theta2);
  return Math.acos(clamp01(Math.abs(dot) === dot ? Math.min(1, dot) : Math.max(-1, dot)));
}

// ------------------------------------------------------------- atardecer
function atardecer(u, v) {
  const theta = v * Math.PI; // 0 = cénit, π = nadir
  const phi = (u - 0.5) * 2 * Math.PI;
  const up = Math.cos(theta); // 1 arriba, -1 abajo

  // Cielo reflejado bajo el horizonte, como sobre un mar en calma: así el
  // fondo luce también con la cámara mirando hacia abajo.
  const a = Math.abs(up);
  const t = Math.pow(1 - a, 2.6);
  let color = mix3([0.085, 0.105, 0.34], [1.35, 0.5, 0.17], t);

  if (up >= 0) {
    // Bandas de nubes suaves solo en el cielo real.
    const cloud =
      Math.max(0, Math.sin(theta * 9 + Math.sin(phi * 3) * 1.4) - 0.72) *
      Math.pow(1 - a, 1.5) *
      0.7;
    color = mix3(color, [1.5, 0.7, 0.38], clamp01(cloud));
  } else {
    // "Agua": el reflejo es algo más oscuro, azulado y con rizo horizontal.
    color = mix3(color, [0.08, 0.1, 0.26], 0.4);
    const ripple = 0.82 + 0.18 * Math.sin(theta * 70 + Math.sin(phi * 5) * 2);
    color = [color[0] * ripple, color[1] * ripple, color[2] * ripple];
  }

  // Sol bajo (tras el tablero desde la vista inicial) y su reflejo.
  const dSun = angDist(theta, phi, Math.PI * 0.47, Math.PI);
  const dRef = angDist(theta, phi, Math.PI * 0.53, Math.PI);
  if (dSun < 0.045) {
    const core = 1 - dSun / 0.045;
    color = mix3(color, [60, 38, 18], clamp01(core * 1.4));
  }
  const glow = Math.exp(-dSun * dSun * 14);
  const streak = 0.7 + 0.3 * Math.sin(theta * 90);
  const refGlow = Math.exp(-dRef * dRef * 9) * 0.55 * streak;
  color = [
    color[0] + glow * 2.2 + refGlow * 1.7,
    color[1] + glow * 0.95 + refGlow * 0.7,
    color[2] + glow * 0.3 + refGlow * 0.22,
  ];
  return color;
}

// ---------------------------------------------------------------- noche
// Estrellas deterministas precolocadas.
const stars = [];
{
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < 2200; i++) {
    // En toda la esfera: el "suelo" también es cielo (panorama flotante).
    stars.push({ u: rnd(), v: rnd(), mag: 1.5 + rnd() ** 3 * 14, size: rnd() < 0.12 ? 2.2 : 1.2 });
  }
}

function noche(u, v) {
  const theta = v * Math.PI;
  const phi = (u - 0.5) * 2 * Math.PI;
  const up = Math.cos(theta);

  const a = Math.abs(up);
  const t = Math.pow(1 - a, 2.0);
  let color = mix3([0.0035, 0.005, 0.016], [0.018, 0.026, 0.05], t);
  // Vía láctea: banda inclinada tenue que cruza toda la esfera.
  const band = Math.exp(-Math.pow((theta - Math.PI * 0.42 + Math.sin(phi) * 0.35) * 3.2, 2));
  const grain = 0.6 + 0.4 * Math.sin(u * 311 + v * 173) * Math.sin(u * 97 - v * 419);
  color = [
    color[0] + band * 0.018 * grain,
    color[1] + band * 0.02 * grain,
    color[2] + band * 0.028 * grain,
  ];

  // Estrellas.
  for (const st of stars) {
    const dx = Math.min(Math.abs(u - st.u), 1 - Math.abs(u - st.u)) * W;
    const dy = Math.abs(v - st.v) * H;
    const d2 = dx * dx + dy * dy;
    if (d2 < st.size * st.size * 4) {
      const fall = Math.exp(-d2 / (st.size * 0.55));
      color = [color[0] + st.mag * fall, color[1] + st.mag * fall, color[2] + st.mag * fall * 1.12];
    }
  }

  // Luna con halo frío (visible tras el tablero desde la vista inicial).
  const d = angDist(theta, phi, Math.PI * 0.3, Math.PI * 0.92);
  if (d < 0.06) {
    const core = clamp01((1 - d / 0.06) * 1.6);
    const crater = 0.85 + 0.15 * Math.sin(u * 700) * Math.sin(v * 900);
    color = mix3(color, [7 * crater, 7.6 * crater, 8.4 * crater], core);
  }
  const halo = Math.exp(-d * d * 90);
  color = [color[0] + halo * 0.25, color[1] + halo * 0.3, color[2] + halo * 0.42];
  return color;
}

writeHdr('atardecer.hdr', atardecer);
writeHdr('noche.hdr', noche);
writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify(
    {
      hdris: [
        { id: 'atardecer', name: 'Atardecer', url: '/hdri/atardecer.hdr' },
        { id: 'noche', name: 'Noche estrellada', url: '/hdri/noche.hdr' },
      ],
    },
    null,
    2,
  ),
);
console.log('[generate-hdri] index.json escrito');
