import * as THREE from 'three';
import { woodTexture } from './textures';

export const SQUARE_SIZE = 1;
const FILES = 'abcdefgh';

export type HighlightKind = 'selected' | 'move' | 'capture' | 'last' | 'check';

const HIGHLIGHT_COLORS: Record<HighlightKind, { color: number; opacity: number }> = {
  selected: { color: 0xf5c542, opacity: 0.65 },
  move: { color: 0x3da9f5, opacity: 0.5 },
  capture: { color: 0xe5533d, opacity: 0.6 },
  last: { color: 0x8bc34a, opacity: 0.35 },
  check: { color: 0xff2020, opacity: 0.6 },
};

export function squareToWorld(square: string, y = 0): THREE.Vector3 {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return new THREE.Vector3((file - 3.5) * SQUARE_SIZE, y, (3.5 - rank) * SQUARE_SIZE);
}

/** Tablero de madera veteada: casillas, marco y planos de resaltado. */
export class Board3D {
  readonly group = new THREE.Group();
  /** Mallas de casillas para el raycaster; cada una lleva userData.square. */
  readonly squareMeshes: THREE.Mesh[] = [];
  private highlights = new Map<string, THREE.Mesh>();

  // Pools de materiales con vetas distintas; el color del set los tiñe.
  private lightMats: THREE.MeshStandardMaterial[] = [];
  private darkMats: THREE.MeshStandardMaterial[] = [];
  private frameMat: THREE.MeshStandardMaterial;

  /** Colores del tablero definidos por el set de piezas activo. */
  applyStyle(style?: { light: string; dark: string; frame: string }): void {
    if (!style) return;
    for (const m of this.lightMats) m.color.set(style.light);
    for (const m of this.darkMats) m.color.set(style.dark);
    this.frameMat.color.set(style.frame);
  }

  constructor() {
    // Varias vetas distintas, cada una también girada 90°, para que el
    // tablero parezca ensamblado pieza a pieza y no un patrón repetido.
    const variants: THREE.Texture[] = [];
    for (let i = 0; i < 6; i++) {
      const tex = woodTexture(11 + i * 137);
      variants.push(tex);
      const rotated = tex.clone();
      rotated.center.set(0.5, 0.5);
      rotated.rotation = Math.PI / 2;
      rotated.needsUpdate = true;
      variants.push(rotated);
    }
    const makeMat = (color: number, map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({ color, map, roughness: 0.55, metalness: 0.04 });
    for (const tex of variants) {
      this.lightMats.push(makeMat(0xd8c79e, tex));
      this.darkMats.push(makeMat(0x6e4a2f, tex));
    }
    const frameTex = woodTexture(999);
    frameTex.repeat.set(5, 5);
    this.frameMat = new THREE.MeshStandardMaterial({
      color: 0x3b2b1d,
      map: frameTex,
      roughness: 0.5,
      metalness: 0.05,
    });

    const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE, 0.25, SQUARE_SIZE);
    let n = 0;
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const square = FILES[file] + (rank + 1);
        const isLight = (file + rank) % 2 === 1;
        const pool = isLight ? this.lightMats : this.darkMats;
        // Asignación pseudoaleatoria pero estable de la veta.
        const mat = pool[(n * 7 + rank * 3) % pool.length];
        n++;
        const mesh = new THREE.Mesh(squareGeo, mat);
        mesh.position.copy(squareToWorld(square, -0.125));
        mesh.receiveShadow = true;
        mesh.userData.square = square;
        this.group.add(mesh);
        this.squareMeshes.push(mesh);

        const hl = new THREE.Mesh(
          new THREE.PlaneGeometry(SQUARE_SIZE * 0.96, SQUARE_SIZE * 0.96),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          }),
        );
        hl.rotation.x = -Math.PI / 2;
        hl.position.copy(squareToWorld(square, 0.012));
        hl.visible = false;
        this.group.add(hl);
        this.highlights.set(square, hl);
      }
    }

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(8 * SQUARE_SIZE + 0.7, 0.22, 8 * SQUARE_SIZE + 0.7),
      this.frameMat,
    );
    frame.position.y = -0.14;
    frame.receiveShadow = true;
    frame.castShadow = true;
    this.group.add(frame);

    // Borde biselado interior del marco.
    const bevel = new THREE.Mesh(
      new THREE.BoxGeometry(8 * SQUARE_SIZE + 0.34, 0.255, 8 * SQUARE_SIZE + 0.34),
      this.frameMat,
    );
    bevel.position.y = -0.13;
    bevel.receiveShadow = true;
    this.group.add(bevel);
  }

  setHighlights(map: Map<string, HighlightKind>): void {
    for (const [square, mesh] of this.highlights) {
      const kind = map.get(square);
      if (kind) {
        const { color, opacity } = HIGHLIGHT_COLORS[kind];
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(color);
        mat.opacity = opacity;
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  }
}
