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
function part(geo, boneIndex, { pos = [0, 0, 0], rotX = 0, rotY = 0, rotZ = 0 } = {}) {
  if (rotX) geo.rotateX(rotX);
  if (rotY) geo.rotateY(rotY);
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
const cyl = (rt, rb, h, s = 18) => new THREE.CylinderGeometry(rt, rb, h, s);
const sphere = (r, w = 18, h = 14) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, s = 12) => new THREE.ConeGeometry(r, h, s);
const torus = (r, tube) => new THREE.TorusGeometry(r, tube, 12, 24);
/** Media esfera abierta hacia abajo (cascos). */
const dome = (r) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);

/** Pedestal de dos niveles, ligado a la base (root). */
function pedestal(r) {
  return [
    part(cyl(r * 0.94, r, 0.06, 24), 0, { pos: [0, 0.03, 0] }),
    part(cyl(r * 0.68, r * 0.9, 0.055, 24), 0, { pos: [0, 0.087, 0] }),
  ];
}

/**
 * Brazo derecho armado (hueso armR). La espada lleva empuñadura, guarda,
 * hoja, punta y pomo; el hacha de la torre, mango largo y pala ancha.
 */
function armParts(shoulderY, { scale = 1, axe = false } = {}) {
  const s = scale;
  const x = ARM.x + 0.035 * s;
  const handY = shoulderY - 0.13 * s;
  const handZ = 0.07;
  const parts = [
    part(sphere(0.048 * s, 12, 10), 3, { pos: [x, shoulderY, 0] }), // hombro
    part(cyl(0.03 * s, 0.038 * s, 0.17 * s, 10), 3, {
      pos: [x + 0.015, shoulderY - 0.075 * s, 0.035],
      rotX: -0.4,
      rotZ: 0.12,
    }),
    part(sphere(0.038 * s, 10, 8), 3, { pos: [x + 0.025, handY, handZ] }), // mano
  ];
  if (axe) {
    parts.push(
      part(cyl(0.014, 0.014, 0.34, 8), 3, { pos: [x + 0.025, handY, handZ + 0.1], rotX: Math.PI / 2 }),
      part(box(0.022, 0.17, 0.1), 3, { pos: [x + 0.025, handY, handZ + 0.24] }),
      part(cone(0.014, 0.05, 6), 3, { pos: [x + 0.025, handY, handZ + 0.32], rotX: Math.PI / 2 }),
    );
  } else {
    parts.push(
      part(cyl(0.015, 0.017, 0.09, 8), 3, { pos: [x + 0.025, handY, handZ], rotX: Math.PI / 2 }), // empuñadura
      part(box(0.095, 0.02, 0.026), 3, { pos: [x + 0.025, handY, handZ + 0.055] }), // guarda
      part(box(0.026, 0.013, 0.24), 3, { pos: [x + 0.025, handY, handZ + 0.18] }), // hoja
      part(cone(0.013, 0.05, 4), 3, { pos: [x + 0.025, handY, handZ + 0.32], rotX: Math.PI / 2 }), // punta
      part(sphere(0.02, 8, 8), 3, { pos: [x + 0.025, handY, handZ - 0.055] }), // pomo
    );
  }
  return parts;
}

/** Escudo redondo con umbo en el costado izquierdo (sigue al torso). */
function shieldParts(y, r) {
  const x = -(ARM.x + 0.045);
  return [
    part(cyl(r, r * 0.92, 0.028, 20), 1, { pos: [x, y, 0.02], rotZ: Math.PI / 2 }),
    part(sphere(r * 0.28, 10, 8), 1, { pos: [x - 0.022, y, 0.02] }),
  ];
}

/** Anillo de puntas para coronas. */
function crownSpikes(n, radius, y, h = 0.075, r = 0.02) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return part(cone(r, h, 6), 2, { pos: [Math.cos(a) * radius, y, Math.sin(a) * radius] });
  });
}

const PIECES = {
  pawn: [
    ...pedestal(0.23),
    part(cyl(0.125, 0.19, 0.18, 18), 1, { pos: [0, 0.2, 0] }), // falda
    part(torus(0.126, 0.018), 1, { pos: [0, 0.29, 0], rotX: Math.PI / 2 }), // cinturón
    part(cyl(0.112, 0.13, 0.17, 18), 1, { pos: [0, 0.375, 0] }), // torso
    part(sphere(0.05, 12, 10), 1, { pos: [0.122, 0.45, 0] }), // hombreras
    part(sphere(0.05, 12, 10), 1, { pos: [-0.122, 0.45, 0] }),
    part(cyl(0.035, 0.045, 0.05, 10), 2, { pos: [0, 0.48, 0] }), // cuello
    part(sphere(0.085), 2, { pos: [0, 0.55, 0] }), // cabeza
    part(dome(0.096), 2, { pos: [0, 0.557, 0] }), // casco
    part(torus(0.094, 0.014), 2, { pos: [0, 0.553, 0], rotX: Math.PI / 2 }), // ala
    ...shieldParts(0.37, 0.095),
    ...armParts(0.43),
  ],
  rook: [
    ...pedestal(0.29),
    part(cyl(0.2, 0.26, 0.2, 18), 1, { pos: [0, 0.21, 0] }),
    part(torus(0.2, 0.022), 1, { pos: [0, 0.315, 0], rotX: Math.PI / 2 }),
    part(cyl(0.165, 0.2, 0.2, 18), 1, { pos: [0, 0.42, 0] }),
    part(sphere(0.068, 12, 10), 1, { pos: [0.185, 0.51, 0] }),
    part(sphere(0.068, 12, 10), 1, { pos: [-0.185, 0.51, 0] }),
    part(box(0.17, 0.14, 0.17), 2, { pos: [0, 0.59, 0] }), // cabeza cúbica
    part(cyl(0.15, 0.16, 0.06, 16), 2, { pos: [0, 0.69, 0] }), // corona de torre
    part(box(0.062, 0.06, 0.05), 2, { pos: [0.105, 0.75, 0] }), // almenas
    part(box(0.062, 0.06, 0.05), 2, { pos: [-0.105, 0.75, 0] }),
    part(box(0.05, 0.06, 0.062), 2, { pos: [0, 0.75, 0.105] }),
    part(box(0.05, 0.06, 0.062), 2, { pos: [0, 0.75, -0.105] }),
    ...shieldParts(0.42, 0.13),
    ...armParts(0.5, { axe: true, scale: 1.15 }),
  ],
  knight: [
    ...pedestal(0.25),
    part(cyl(0.145, 0.21, 0.18, 18), 1, { pos: [0, 0.2, 0] }),
    part(torus(0.147, 0.02), 1, { pos: [0, 0.29, 0], rotX: Math.PI / 2 }),
    part(cyl(0.118, 0.148, 0.18, 18), 1, { pos: [0, 0.38, 0] }),
    part(sphere(0.052, 12, 10), 1, { pos: [0.135, 0.46, 0] }),
    part(sphere(0.052, 12, 10), 1, { pos: [-0.135, 0.46, 0] }),
    part(cyl(0.072, 0.1, 0.3, 14), 2, { pos: [0, 0.56, 0.02], rotX: -0.45 }), // cuello equino
    part(box(0.034, 0.3, 0.085), 2, { pos: [0, 0.6, -0.055], rotX: -0.45 }), // crin
    part(box(0.122, 0.115, 0.22), 2, { pos: [0, 0.69, 0.12], rotX: -0.12 }), // cabeza
    part(box(0.082, 0.082, 0.13), 2, { pos: [0, 0.652, 0.255], rotX: -0.1 }), // hocico
    part(cone(0.032, 0.09, 6), 2, { pos: [0.05, 0.785, 0.05], rotX: -0.2 }), // orejas
    part(cone(0.032, 0.09, 6), 2, { pos: [-0.05, 0.785, 0.05], rotX: -0.2 }),
    ...shieldParts(0.38, 0.105),
    ...armParts(0.45),
  ],
  bishop: [
    ...pedestal(0.24),
    part(cyl(0.112, 0.205, 0.32, 20), 1, { pos: [0, 0.27, 0] }), // túnica
    part(torus(0.114, 0.016), 1, { pos: [0, 0.425, 0], rotX: Math.PI / 2 }),
    part(cyl(0.092, 0.113, 0.16, 16), 1, { pos: [0, 0.5, 0] }),
    part(sphere(0.042, 10, 8), 1, { pos: [0.103, 0.565, 0] }),
    part(sphere(0.042, 10, 8), 1, { pos: [-0.103, 0.565, 0] }),
    part(cyl(0.03, 0.04, 0.05, 10), 2, { pos: [0, 0.6, 0] }),
    part(sphere(0.078), 2, { pos: [0, 0.665, 0] }),
    part(cone(0.086, 0.2, 16), 2, { pos: [0, 0.795, 0] }), // mitra
    part(torus(0.07, 0.012), 2, { pos: [0, 0.71, 0], rotX: Math.PI / 2 }),
    part(sphere(0.022, 8, 8), 2, { pos: [0, 0.9, 0] }),
    ...armParts(0.55, { scale: 0.92 }),
  ],
  queen: [
    ...pedestal(0.26),
    part(cyl(0.102, 0.23, 0.38, 22), 1, { pos: [0, 0.3, 0] }), // vestido
    part(torus(0.104, 0.015), 1, { pos: [0, 0.485, 0], rotX: Math.PI / 2 }),
    part(cyl(0.082, 0.103, 0.18, 16), 1, { pos: [0, 0.58, 0] }),
    part(sphere(0.04, 10, 8), 1, { pos: [0.093, 0.665, 0] }),
    part(sphere(0.04, 10, 8), 1, { pos: [-0.093, 0.665, 0] }),
    part(torus(0.06, 0.011), 1, { pos: [0, 0.64, 0], rotX: Math.PI / 2 }), // collar
    part(cyl(0.028, 0.036, 0.05, 10), 2, { pos: [0, 0.695, 0] }),
    part(sphere(0.074), 2, { pos: [0, 0.757, 0] }),
    part(cyl(0.077, 0.084, 0.045, 16), 2, { pos: [0, 0.838, 0] }), // corona
    ...crownSpikes(5, 0.062, 0.885),
    part(sphere(0.02, 8, 8), 2, { pos: [0, 0.885, 0] }),
    ...armParts(0.62, { scale: 0.9 }),
  ],
  king: [
    ...pedestal(0.27),
    part(cyl(0.118, 0.24, 0.4, 22), 1, { pos: [0, 0.31, 0] }), // túnica real
    part(torus(0.12, 0.018), 1, { pos: [0, 0.505, 0], rotX: Math.PI / 2 }),
    part(cyl(0.098, 0.12, 0.2, 16), 1, { pos: [0, 0.61, 0] }),
    part(sphere(0.05, 12, 10), 1, { pos: [0.113, 0.7, 0] }),
    part(sphere(0.05, 12, 10), 1, { pos: [-0.113, 0.7, 0] }),
    part(box(0.24, 0.36, 0.024), 1, { pos: [0, 0.5, -0.125], rotX: 0.1 }), // capa
    part(cyl(0.032, 0.042, 0.05, 10), 2, { pos: [0, 0.73, 0] }),
    part(sphere(0.079), 2, { pos: [0, 0.795, 0] }),
    part(cyl(0.082, 0.09, 0.05, 16), 2, { pos: [0, 0.878, 0] }), // corona
    ...crownSpikes(6, 0.068, 0.925, 0.06, 0.018),
    part(box(0.034, 0.13, 0.034), 2, { pos: [0, 0.99, 0] }), // cruz
    part(box(0.095, 0.034, 0.034), 2, { pos: [0, 1.012, 0] }),
    ...armParts(0.66),
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
