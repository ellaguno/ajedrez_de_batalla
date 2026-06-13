import * as THREE from 'three';
import type { Color } from 'chess.js';
import { PieceActor } from './PieceActor';
import type { PieceSet, PieceType } from './types';

/**
 * Set builtin "clásico": piezas torneadas estilo Staunton, procedurales,
 * sin esqueleto ni animaciones. Sirve de fallback si un set GLB no carga.
 */
const WHITE_MAT = new THREE.MeshStandardMaterial({
  color: 0xf2ead6,
  roughness: 0.28,
  metalness: 0.05,
});
const BLACK_MAT = new THREE.MeshStandardMaterial({
  color: 0x2f2b27,
  roughness: 0.32,
  metalness: 0.15,
});

function lathe(points: [number, number][]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    32,
  );
}

/** Base torneada común: peana ancha con garganta y filete. */
function basePts(r: number): [number, number][] {
  return [
    [r, 0],
    [r, 0.04],
    [r * 0.97, 0.07],
    [r * 0.88, 0.1],
    [r * 0.72, 0.125],
    [r * 0.62, 0.155],
    [r * 0.58, 0.19],
  ];
}

const PROFILES: Partial<Record<PieceType, [number, number][]>> = {
  p: [
    ...basePts(0.3),
    [0.145, 0.23],
    [0.115, 0.3],
    [0.1, 0.38],
    [0.095, 0.44],
    [0.13, 0.475],
    [0.142, 0.495],
    [0.11, 0.515],
    [0.07, 0.53],
  ],
  r: [
    ...basePts(0.32),
    [0.175, 0.24],
    [0.15, 0.33],
    [0.14, 0.45],
    [0.142, 0.55],
    [0.16, 0.59],
    [0.2, 0.62],
    [0.205, 0.66],
    [0.205, 0.72],
    [0.16, 0.72],
    [0.16, 0.665],
    [0, 0.665],
  ],
  b: [
    ...basePts(0.3),
    [0.15, 0.235],
    [0.12, 0.3],
    [0.1, 0.4],
    [0.092, 0.5],
    [0.125, 0.535],
    [0.14, 0.555],
    [0.11, 0.575],
    [0.085, 0.59],
  ],
  q: [
    ...basePts(0.33),
    [0.175, 0.245],
    [0.14, 0.33],
    [0.115, 0.46],
    [0.1, 0.58],
    [0.095, 0.65],
    [0.135, 0.685],
    [0.152, 0.71],
    [0.115, 0.735],
    [0.1, 0.745],
    [0.15, 0.805],
    [0.135, 0.825],
  ],
  k: [
    ...basePts(0.34),
    [0.185, 0.25],
    [0.15, 0.34],
    [0.125, 0.48],
    [0.107, 0.62],
    [0.1, 0.7],
    [0.145, 0.735],
    [0.163, 0.76],
    [0.12, 0.785],
    [0.105, 0.795],
    [0.155, 0.855],
    [0.165, 0.875],
    [0.12, 0.885],
  ],
};

/** Collar fino (anillo) a la altura indicada. */
function collar(mat: THREE.Material, r: number, y: number): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 10, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  return ring;
}

function buildKnight(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([...basePts(0.31), [0.16, 0.24], [0.15, 0.3]]), mat));
  g.add(collar(mat, 0.155, 0.3));

  // Pecho y cuello arqueado.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.155, 0.22, 18), mat);
  chest.position.set(0, 0.4, 0);
  chest.rotation.x = -0.18;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.135, 0.34, 16), mat);
  neck.position.set(0, 0.56, 0.045);
  neck.rotation.x = -0.42;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.18, 14), mat);
  upper.position.set(0, 0.7, 0.13);
  upper.rotation.x = -0.7;

  // Cabeza, hocico, orejas y crin.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.135, 0.27), mat);
  head.position.set(0, 0.77, 0.21);
  head.rotation.x = -0.25;
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.066, 0.14, 12), mat);
  muzzle.position.set(0, 0.73, 0.345);
  muzzle.rotation.x = Math.PI / 2 - 0.35;
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.1, 8), mat);
  earL.position.set(0.05, 0.875, 0.13);
  earL.rotation.x = -0.25;
  const earR = earL.clone();
  earR.position.x = -0.05;
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.4, 0.1), mat);
  mane.position.set(0, 0.56, -0.07);
  mane.rotation.x = -0.42;
  const maneTop = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.09), mat);
  maneTop.position.set(0, 0.76, 0.07);
  maneTop.rotation.x = -0.6;

  g.add(chest, neck, upper, head, muzzle, earL, earR, mane, maneTop);
  return g;
}

export function buildPiece(type: PieceType, color: Color): THREE.Group {
  const mat = color === 'w' ? WHITE_MAT : BLACK_MAT;
  const group = new THREE.Group();

  if (type === 'n') {
    const horse = buildKnight(mat);
    group.add(horse);
    group.rotation.y = color === 'w' ? Math.PI : 0;
  } else {
    group.add(new THREE.Mesh(lathe(PROFILES[type]!), mat));

    if (type === 'p') {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), mat);
      ball.position.y = 0.615;
      group.add(ball);
    }
    if (type === 'r') {
      // Almenas sobre la plataforma torneada.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.062), mat);
        merlon.position.set(Math.cos(a) * 0.165, 0.755, Math.sin(a) * 0.165);
        merlon.rotation.y = -a + Math.PI / 2;
        group.add(merlon);
      }
    }
    if (type === 'b') {
      group.add(collar(mat, 0.11, 0.55));
      const mitre = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), mat);
      mitre.scale.set(1, 1.35, 1);
      mitre.position.y = 0.69;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mat);
      tip.position.y = 0.875;
      group.add(mitre, tip);
    }
    if (type === 'q') {
      group.add(collar(mat, 0.12, 0.7));
      // Coronilla de puntas redondeadas.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), mat);
        bead.position.set(Math.cos(a) * 0.125, 0.845, Math.sin(a) * 0.125);
        group.add(bead);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.062, 18, 14), mat);
      orb.position.y = 0.875;
      group.add(orb);
    }
    if (type === 'k') {
      group.add(collar(mat, 0.125, 0.755));
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), mat);
      orb.position.y = 0.91;
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.17, 0.042), mat);
      v.position.y = 1.015;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.042, 0.042), mat);
      h.position.y = 1.03;
      group.add(orb, v, h);
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
