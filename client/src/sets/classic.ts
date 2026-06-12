import * as THREE from 'three';
import type { Color } from 'chess.js';
import { PieceActor } from './PieceActor';
import type { PieceSet, PieceType } from './types';

/**
 * Set builtin "clásico": piezas torneadas procedurales, sin esqueleto ni
 * animaciones. Sirve de fallback si un set basado en GLB no carga.
 */
const WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.35, metalness: 0.05 });
const BLACK_MAT = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.4, metalness: 0.1 });

function lathe(points: [number, number][]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  );
}

const PROFILES: Partial<Record<PieceType, [number, number][]>> = {
  p: [[0.26, 0], [0.26, 0.05], [0.15, 0.12], [0.11, 0.3], [0.15, 0.38], [0.07, 0.44], [0.14, 0.5], [0.15, 0.56], [0.08, 0.64], [0, 0.67]],
  r: [[0.3, 0], [0.3, 0.06], [0.2, 0.15], [0.17, 0.5], [0.24, 0.56], [0.24, 0.72], [0.18, 0.72], [0.18, 0.66], [0, 0.66]],
  b: [[0.28, 0], [0.28, 0.05], [0.17, 0.12], [0.1, 0.42], [0.15, 0.52], [0.08, 0.68], [0.11, 0.72], [0.05, 0.8], [0, 0.84]],
  q: [[0.31, 0], [0.31, 0.06], [0.2, 0.14], [0.12, 0.52], [0.19, 0.66], [0.1, 0.78], [0.15, 0.84], [0.06, 0.92], [0, 0.96]],
  k: [[0.31, 0], [0.31, 0.06], [0.2, 0.14], [0.13, 0.58], [0.2, 0.7], [0.12, 0.84], [0.17, 0.88], [0.04, 0.94], [0, 0.95]],
};

function buildPiece(type: PieceType, color: Color): THREE.Group {
  const mat = color === 'w' ? WHITE_MAT : BLACK_MAT;
  const group = new THREE.Group();

  if (type === 'n') {
    const base = new THREE.Mesh(lathe([[0.29, 0], [0.29, 0.06], [0.18, 0.13], [0.15, 0.3]]), mat);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.45, 0.26), mat);
    neck.position.set(0, 0.5, 0.02);
    neck.rotation.x = -0.35;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.34), mat);
    head.position.set(0, 0.68, 0.16);
    const ears = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), mat);
    ears.position.set(0, 0.82, 0.04);
    group.add(base, neck, head, ears);
    group.rotation.y = color === 'w' ? Math.PI : 0;
  } else {
    const profile = PROFILES[type]!;
    group.add(new THREE.Mesh(lathe(profile), mat));
    if (type === 'q') {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), mat);
      orb.position.y = 0.99;
      group.add(orb);
    }
    if (type === 'k') {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), mat);
      v.position.y = 1.06;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), mat);
      h.position.y = 1.08;
      group.add(v, h);
    }
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return group;
}

export function classicSet(): PieceSet {
  return {
    id: 'clasico',
    name: 'Clásico (sin animación)',
    createPiece: (type, color) => new PieceActor(buildPiece(type, color)),
  };
}
