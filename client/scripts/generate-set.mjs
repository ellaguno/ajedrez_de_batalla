/**
 * Genera el set de piezas "Guerreros Geométricos": 6 modelos GLB low-poly
 * con esqueleto (root → spine → head, + armR con espada) y clips de
 * animación (idle, walk, attack, die, win), exportados con GLTFExporter.
 *
 * Sirve como set de referencia del pipeline: cualquier set "real"
 * (Blender, Mixamo, Meshy/Tripo) entra por el mismo formato.
 *
 * Uso: node client/scripts/generate-set.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// GLTFExporter usa FileReader (API de navegador) para ensamblar el GLB.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.({ target: this });
        this.onload?.({ target: this });
      });
    }
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'sets', 'guerreros');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- esqueleto
// Mismo esqueleto para las 6 piezas; solo cambia la geometría adherida.
// Índices: 0=root (base), 1=spine (torso), 2=head, 3=armR (brazo + espada).
const SPINE_Y = 0.26;
const HEAD_Y = 0.28; // relativo a spine → cabeza a ~0.54 en mundo
const ARM = { x: 0.17, y: 0.12, z: 0 }; // relativo a spine

function makeBones() {
  const root = new THREE.Bone();
  root.name = 'root';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = SPINE_Y;
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = HEAD_Y;
  const armR = new THREE.Bone();
  armR.name = 'armR';
  armR.position.set(ARM.x, ARM.y, ARM.z);
  root.add(spine);
  spine.add(head);
  spine.add(armR);
  return [root, spine, head, armR];
}

// ------------------------------------------------------------- construcción
/** Prepara una geometría: la transforma y la liga rígidamente a un hueso. */
function part(geo, boneIndex, { pos = [0, 0, 0], rotX = 0, rotZ = 0 } = {}) {
  if (rotX) geo.rotateX(rotX);
  if (rotZ) geo.rotateZ(rotZ);
  geo.translate(...pos);
  const count = geo.attributes.position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = boneIndex;
    skinWeight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.deleteAttribute('uv'); // sin texturas; evita incompatibilidades al fusionar
  return geo;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sphere = (r) => new THREE.SphereGeometry(r, 12, 8);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);

/** Brazo derecho con espada, común a todas las piezas. */
function armParts() {
  // En espacio del modelo: el hombro (hueso armR) queda en (~0.17, 0.38, 0).
  const sx = ARM.x + 0.05;
  return [
    part(box(0.08, 0.26, 0.08), 3, { pos: [sx, 0.3, 0] }),
    part(box(0.05, 0.05, 0.3), 3, { pos: [sx, 0.2, 0.16] }), // empuñadura→hoja
    part(cone(0.035, 0.12, 4), 3, { pos: [sx, 0.2, 0.36], rotX: Math.PI / 2 }),
  ];
}

const PIECES = {
  pawn: [
    part(cyl(0.2, 0.24, 0.08), 0, { pos: [0, 0.04, 0] }),
    part(box(0.22, 0.26, 0.18), 1, { pos: [0, 0.33, 0] }),
    part(sphere(0.105), 2, { pos: [0, 0.52, 0] }),
    ...armParts(),
  ],
  rook: [
    part(cyl(0.26, 0.3, 0.09), 0, { pos: [0, 0.045, 0] }),
    part(box(0.32, 0.34, 0.26), 1, { pos: [0, 0.37, 0] }),
    part(box(0.34, 0.09, 0.28), 2, { pos: [0, 0.58, 0] }),
    part(box(0.1, 0.1, 0.28), 2, { pos: [0, 0.67, 0] }),
    part(box(0.34, 0.1, 0.1), 2, { pos: [0, 0.67, 0] }),
    ...armParts(),
  ],
  knight: [
    part(cyl(0.22, 0.26, 0.08), 0, { pos: [0, 0.04, 0] }),
    part(box(0.24, 0.3, 0.2), 1, { pos: [0, 0.35, 0] }),
    part(box(0.16, 0.16, 0.32), 2, { pos: [0, 0.58, 0.08] }),
    part(cone(0.05, 0.12, 4), 2, { pos: [0.06, 0.7, -0.02] }),
    part(cone(0.05, 0.12, 4), 2, { pos: [-0.06, 0.7, -0.02] }),
    ...armParts(),
  ],
  bishop: [
    part(cyl(0.22, 0.26, 0.08), 0, { pos: [0, 0.04, 0] }),
    part(cyl(0.1, 0.2, 0.4), 1, { pos: [0, 0.36, 0] }),
    part(cone(0.13, 0.24, 8), 2, { pos: [0, 0.62, 0] }),
    part(sphere(0.045), 2, { pos: [0, 0.76, 0] }),
    ...armParts(),
  ],
  queen: [
    part(cyl(0.24, 0.28, 0.09), 0, { pos: [0, 0.045, 0] }),
    part(cyl(0.12, 0.22, 0.5), 1, { pos: [0, 0.41, 0] }),
    part(cyl(0.16, 0.12, 0.1), 2, { pos: [0, 0.7, 0] }),
    part(cone(0.05, 0.14, 4), 2, { pos: [0, 0.81, 0] }),
    part(cone(0.04, 0.1, 4), 2, { pos: [0.09, 0.78, 0] }),
    part(cone(0.04, 0.1, 4), 2, { pos: [-0.09, 0.78, 0] }),
    ...armParts(),
  ],
  king: [
    part(cyl(0.24, 0.28, 0.09), 0, { pos: [0, 0.045, 0] }),
    part(cyl(0.13, 0.23, 0.55), 1, { pos: [0, 0.44, 0] }),
    part(cyl(0.17, 0.13, 0.1), 2, { pos: [0, 0.76, 0] }),
    part(box(0.06, 0.22, 0.06), 2, { pos: [0, 0.92, 0] }),
    part(box(0.16, 0.06, 0.06), 2, { pos: [0, 0.94, 0] }),
    ...armParts(),
  ],
};

// ---------------------------------------------------------------- animación
const euler = (x = 0, y = 0, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();

function quatTrack(bone, times, eulers) {
  return new THREE.QuaternionKeyframeTrack(
    `${bone}.quaternion`,
    times,
    eulers.flatMap((e) => euler(...e)),
  );
}

function posTrack(bone, times, positions) {
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, positions.flat());
}

// Posiciones de reposo de cada hueso (las pistas de posición son absolutas).
const REST = { root: [0, 0, 0], spine: [0, SPINE_Y, 0], armR: [ARM.x, ARM.y, ARM.z] };
const rootAt = (dy, dz = 0) => [0, dy, dz];

function makeClips() {
  const idle = new THREE.AnimationClip('idle', 2.4, [
    quatTrack('spine', [0, 0.6, 1.2, 1.8, 2.4], [[0, 0, 0], [0, 0, 0.05], [0, 0, 0], [0, 0, -0.05], [0, 0, 0]]),
    quatTrack('head', [0, 1.2, 2.4], [[0, -0.12, 0], [0, 0.12, 0], [0, -0.12, 0]]),
    quatTrack('armR', [0, 1.2, 2.4], [[0.06, 0, 0], [-0.06, 0, 0], [0.06, 0, 0]]),
  ]);

  const walk = new THREE.AnimationClip('walk', 0.6, [
    posTrack('root', [0, 0.15, 0.3, 0.45, 0.6], [rootAt(0), rootAt(0.045), rootAt(0), rootAt(0.045), rootAt(0)]),
    quatTrack('spine', [0, 0.6], [[0.14, 0, 0], [0.14, 0, 0]]),
    quatTrack('armR', [0, 0.3, 0.6], [[0.5, 0, 0], [-0.5, 0, 0], [0.5, 0, 0]]),
  ]);

  const attack = new THREE.AnimationClip('attack', 1.0, [
    quatTrack('spine', [0, 0.25, 0.5, 0.75, 1.0], [[0, 0, 0], [-0.18, 0.5, 0], [0.28, -0.45, 0], [0.1, -0.15, 0], [0, 0, 0]]),
    quatTrack('armR', [0, 0.3, 0.5, 0.7, 1.0], [[0, 0, 0], [-2.3, 0, 0.25], [0.8, 0, -0.15], [0.4, 0, 0], [0, 0, 0]]),
    posTrack('root', [0, 0.3, 0.5, 0.75, 1.0], [rootAt(0), rootAt(0.02, 0.06), rootAt(0, -0.16), rootAt(0, -0.06), rootAt(0)]),
  ]);

  const die = new THREE.AnimationClip('die', 1.4, [
    quatTrack('root', [0, 0.25, 0.45, 0.8, 1.4], [[0, 0, 0], [0, 0, 0.14], [0, 0, -0.3], [0, 0, -1.45], [0, 0, -1.52]]),
    quatTrack('armR', [0, 0.4, 0.8], [[0, 0, 0], [-1.2, 0, 0.8], [-1.4, 0, 1.0]]),
    quatTrack('head', [0, 0.8, 1.4], [[0, 0, 0], [0.4, 0, 0.3], [0.5, 0, 0.35]]),
  ]);

  const win = new THREE.AnimationClip('win', 1.2, [
    posTrack('root', [0, 0.2, 0.4, 0.55, 0.7, 1.2], [rootAt(0), rootAt(0.2), rootAt(0), rootAt(0.13), rootAt(0), rootAt(0)]),
    quatTrack('armR', [0, 0.2, 0.5, 0.8, 1.2], [[0, 0, 0], [-2.6, 0, 0], [-2.9, 0, 0.3], [-2.6, 0, 0], [0, 0, 0]]),
  ]);

  // Las pistas de posición/rotación que no vuelven al reposo deben fijarse en
  // los huesos no animados de cada clip para no heredar poses de otros clips:
  // (el cliente resetea con stop(); aquí basta con clips bien formados)
  return [idle, walk, attack, die, win];
}

// ------------------------------------------------------------------- export
function buildModel(name, parts) {
  const bones = makeBones();
  const merged = mergeGeometries(parts);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.08,
    name: 'piel',
  });
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = `${name}_mesh`;
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const scene = new THREE.Group();
  scene.name = name;
  scene.add(mesh);
  return scene;
}

function exportGLB(scene, clips) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(Buffer.from(result)),
      reject,
      { binary: true, animations: clips },
    );
  });
}

const clips = makeClips();
for (const [name, parts] of Object.entries(PIECES)) {
  const glb = await exportGLB(buildModel(name, parts), clips);
  writeFileSync(join(OUT, `${name}.glb`), glb);
  console.log(`[generate-set] ${name}.glb (${(glb.length / 1024).toFixed(1)} KB)`);
}

writeFileSync(
  join(OUT, 'set.json'),
  JSON.stringify(
    {
      format: 1,
      id: 'guerreros',
      name: 'Guerreros Geométricos',
      pieces: {
        p: { model: 'pawn.glb' },
        r: { model: 'rook.glb' },
        n: { model: 'knight.glb' },
        b: { model: 'bishop.glb' },
        q: { model: 'queen.glb' },
        k: { model: 'king.glb' },
      },
      clips: { idle: 'idle', walk: 'walk', attack: 'attack', die: 'die', win: 'win' },
      colors: { w: '#e8dfc8', b: '#3a3531' },
      scale: 1.0,
      board: { light: '#d8c79e', dark: '#6e4a2f', frame: '#3b2b1d' },
    },
    null,
    2,
  ),
);

writeFileSync(
  join(OUT, '..', 'index.json'),
  JSON.stringify(
    {
      sets: [
        { id: 'guerreros', name: 'Guerreros Geométricos', dir: 'guerreros' },
        { id: 'clasico', name: 'Clásico (sin animación)', builtin: true },
      ],
    },
    null,
    2,
  ),
);
console.log('[generate-set] set.json e index.json escritos');
