import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { Color } from 'chess.js';
import { PieceActor } from './PieceActor';
import { classicSet } from './classic';
import type { PieceSet, PieceSetInfo, PieceType, SetManifest } from './types';

export async function listSets(): Promise<PieceSetInfo[]> {
  try {
    const r = await fetch('/sets/index.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { sets: PieceSetInfo[] };
    if (Array.isArray(data.sets) && data.sets.length > 0) return data.sets;
  } catch (err) {
    console.warn('No se pudo leer /sets/index.json; solo set clásico', err);
  }
  return [{ id: 'clasico', name: 'Clásico (sin animación)', builtin: true }];
}

export async function loadSet(info: PieceSetInfo): Promise<PieceSet> {
  if (info.builtin || info.id === 'clasico' || (!info.dir && !info.base)) return classicSet();

  const base = info.base ?? `/sets/${info.dir}`;
  const res = await fetch(`${base}/set.json`);
  if (!res.ok) throw new Error(`set.json de "${info.id}": HTTP ${res.status}`);
  const manifest = (await res.json()) as SetManifest;

  const loader = new GLTFLoader();
  const templates = new Map<PieceType, { scene: THREE.Object3D; clips: THREE.AnimationClip[] }>();
  await Promise.all(
    (Object.entries(manifest.pieces) as [PieceType, { model: string }][]).map(
      async ([type, def]) => {
        const gltf = await loader.loadAsync(`${base}/${def.model}`);
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.frustumCulled = false; // los huesos mueven la malla fuera de su AABB original
          }
        });
        templates.set(type, { scene: gltf.scene, clips: gltf.animations });
      },
    ),
  );

  // Un material por color para todo el set (las piezas se tiñen al instanciar).
  const materials: Record<Color, THREE.MeshStandardMaterial> = {
    w: new THREE.MeshStandardMaterial({ color: manifest.colors.w, roughness: 0.5, metalness: 0.1 }),
    b: new THREE.MeshStandardMaterial({ color: manifest.colors.b, roughness: 0.5, metalness: 0.1 }),
  };
  const scale = manifest.scale ?? 1;

  return {
    id: manifest.id,
    name: manifest.name,
    board: manifest.board,
    createPiece(type: PieceType, color: Color): PieceActor {
      const template = templates.get(type);
      if (!template) throw new Error(`El set "${manifest.id}" no trae la pieza "${type}"`);
      const model = skeletonClone(template.scene);
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = materials[color];
      });
      model.scale.setScalar(scale);
      // Cada bando mira hacia su rival (blancas hacia -z, negras hacia +z).
      model.rotation.y = color === 'w' ? Math.PI : 0;
      return new PieceActor(model, template.clips, manifest.clips);
    },
  };
}
