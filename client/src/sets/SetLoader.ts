import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { Color } from 'chess.js';
import { PieceActor } from './PieceActor';
import { classicSet } from './classic';
import type { PieceSet, PieceSetInfo, PieceType, SetManifest } from './types';

/** Sets de fábrica, por si el catálogo del servidor no está disponible. */
const FALLBACK_SETS: PieceSetInfo[] = [
  { id: 'guerreros', name: 'Guerreros Geométricos', dir: 'guerreros' },
  { id: 'clasico', name: 'Clásico (sin animación)', builtin: true },
];

export async function listSets(): Promise<PieceSetInfo[]> {
  try {
    const r = await fetch('/sets/index.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { sets: PieceSetInfo[] };
    if (Array.isArray(data.sets) && data.sets.length > 0) return data.sets;
    console.warn('Catálogo de sets vacío; se usan los sets de fábrica');
  } catch (err) {
    console.warn('No se pudo leer /sets/index.json; se usan los sets de fábrica', err);
  }
  return FALLBACK_SETS;
}

export async function loadSet(info: PieceSetInfo): Promise<PieceSet> {
  if (info.builtin || info.id === 'clasico' || (!info.dir && !info.base)) return classicSet();

  const base = info.base ?? `/sets/${info.dir}`;
  const res = await fetch(`${base}/set.json`);
  if (!res.ok) throw new Error(`set.json de "${info.id}": HTTP ${res.status}`);
  const manifest = (await res.json()) as SetManifest;

  const loader = new GLTFLoader();
  interface Template {
    scene: THREE.Object3D;
    clips: THREE.AnimationClip[];
  }
  const cache = new Map<string, Promise<Template>>();
  const loadModel = (file: string): Promise<Template> => {
    let p = cache.get(file);
    if (!p) {
      p = loader.loadAsync(`${base}/${file}`).then((gltf) => {
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.frustumCulled = false; // los huesos mueven la malla fuera de su AABB original
          }
        });
        return { scene: gltf.scene, clips: gltf.animations };
      });
      cache.set(file, p);
    }
    return p;
  };

  // Cada pieza: un modelo teñido por bando ("model") o un modelo por color
  // con sus propios materiales ("modelW"/"modelB").
  const templates = new Map<string, Template>();
  await Promise.all(
    (Object.entries(manifest.pieces) as [PieceType, import('./types').PieceDef][]).flatMap(
      ([type, def]) => {
        const jobs: Promise<void>[] = [];
        for (const color of ['w', 'b'] as const) {
          const file = color === 'w' ? (def.modelW ?? def.model) : (def.modelB ?? def.model);
          if (!file) throw new Error(`Pieza "${type}" sin modelo en el set "${manifest.id}"`);
          jobs.push(
            loadModel(file).then((t) => {
              templates.set(`${type}:${color}`, t);
            }),
          );
        }
        return jobs;
      },
    ),
  );

  // Un material por color para todo el set (solo para piezas con "model").
  const colors = manifest.colors ?? { w: '#e8dfc8', b: '#3a3531' };
  const materials: Record<Color, THREE.MeshStandardMaterial> = {
    w: new THREE.MeshStandardMaterial({ color: colors.w, roughness: 0.5, metalness: 0.1 }),
    b: new THREE.MeshStandardMaterial({ color: colors.b, roughness: 0.5, metalness: 0.1 }),
  };
  const scale = manifest.scale ?? 1;

  return {
    id: manifest.id,
    name: manifest.name,
    board: manifest.board,
    createPiece(type: PieceType, color: Color): PieceActor {
      const template = templates.get(`${type}:${color}`);
      if (!template) throw new Error(`El set "${manifest.id}" no trae la pieza "${type}"`);
      const def = manifest.pieces[type];
      const ownMaterials = color === 'w' ? !!def.modelW : !!def.modelB;
      const model = skeletonClone(template.scene);
      if (!ownMaterials) {
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = materials[color];
        });
      }
      model.scale.setScalar(scale);
      // Cada bando mira hacia su rival (blancas hacia -z, negras hacia +z).
      model.rotation.y = color === 'w' ? Math.PI : 0;
      return new PieceActor(model, template.clips, manifest.clips);
    },
  };
}
