/**
 * Exporta el set "Clásico" (procedural, src/sets/classic.ts) a archivos GLB
 * editables en Blender, junto con su set.json y un ZIP listo para subir
 * desde la página de administración (/admin.html → "Sets de piezas").
 *
 * Uso:    npm run export:classic --workspace=client
 * Salida: client/scripts/export/clasico-editable/  (+ clasico-editable.zip)
 *
 * Los GLB salen sin esqueleto ni animaciones (el set Clásico no los tiene);
 * el juego usa sus fundidos/movimientos de reserva, igual que con el set
 * integrado. En Blender se abren con File > Import > glTF 2.0.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import AdmZip from 'adm-zip';
import { buildPiece } from '../src/sets/classic';
import type { PieceType } from '../src/sets/types';

// GLTFExporter usa FileReader (API de navegador) para ensamblar el GLB.
if (typeof globalThis.FileReader === 'undefined') {
  (globalThis as any).FileReader = class {
    result: unknown;
    onload?: (ev: unknown) => void;
    onloadend?: (ev: unknown) => void;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'export', 'clasico-editable');
mkdirSync(OUT, { recursive: true });

const FILES: Record<PieceType, string> = {
  p: 'pawn.glb',
  r: 'rook.glb',
  n: 'knight.glb',
  b: 'bishop.glb',
  q: 'queen.glb',
  k: 'king.glb',
};

// Un único material neutro: en el juego el SetLoader lo reemplaza por el
// color de cada bando ("colors" del set.json); en Blender queda un solo
// material limpio que editar.
const NEUTRAL = new THREE.MeshStandardMaterial({
  color: 0xe8dfc8,
  roughness: 0.5,
  metalness: 0.1,
});
NEUTRAL.name = 'pieza';

function exportGlb(scene: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true },
    );
  });
}

for (const [type, file] of Object.entries(FILES) as [PieceType, string][]) {
  // 'b' (negras) es la orientación canónica: el modelo mira hacia +z y el
  // juego rota π a las blancas al instanciar.
  const group = buildPiece(type, 'b');
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = NEUTRAL;
  });
  group.name = file.replace('.glb', '');
  const glb = await exportGlb(group);
  writeFileSync(join(OUT, file), Buffer.from(glb));
  console.log(`✔ ${file} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
}

const manifest = {
  format: 1,
  id: 'clasico-editable',
  name: 'Clásico (editable)',
  pieces: Object.fromEntries(
    Object.entries(FILES).map(([type, file]) => [type, { model: file }]),
  ),
  clips: {},
  colors: { w: '#f2ead6', b: '#2f2b27' },
  scale: 1,
  board: { light: '#d8c79e', dark: '#6e4a2f', frame: '#3b2b1d' },
};
writeFileSync(join(OUT, 'set.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('✔ set.json');

// ZIP plano (set.json + GLBs en la raíz), como lo espera /admin.html.
const zip = new AdmZip();
for (const name of ['set.json', ...Object.values(FILES)]) {
  zip.addFile(name, readFileSync(join(OUT, name)));
}
const zipPath = join(here, 'export', 'clasico-editable.zip');
zip.writeZip(zipPath);
console.log(`\nListo: ${OUT}`);
console.log(`ZIP para subir en /admin.html: ${zipPath}`);
console.log('En Blender: File > Import > glTF 2.0 (no File > Open).');
