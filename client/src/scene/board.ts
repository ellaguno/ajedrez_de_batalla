import * as THREE from 'three';

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

/** Tablero: casillas, marco y planos de resaltado. */
export class Board3D {
  readonly group = new THREE.Group();
  /** Mallas de casillas para el raycaster; cada una lleva userData.square. */
  readonly squareMeshes: THREE.Mesh[] = [];
  private highlights = new Map<string, THREE.Mesh>();

  private lightMat = new THREE.MeshStandardMaterial({ color: 0xd8c79e, roughness: 0.55 });
  private darkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2f, roughness: 0.55 });
  private frameMat = new THREE.MeshStandardMaterial({ color: 0x3b2b1d, roughness: 0.6 });

  /** Colores del tablero definidos por el set de piezas activo. */
  applyStyle(style?: { light: string; dark: string; frame: string }): void {
    if (!style) return;
    this.lightMat.color.set(style.light);
    this.darkMat.color.set(style.dark);
    this.frameMat.color.set(style.frame);
  }

  constructor() {
    const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE, 0.25, SQUARE_SIZE);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const square = FILES[file] + (rank + 1);
        const isLight = (file + rank) % 2 === 1;
        const mesh = new THREE.Mesh(squareGeo, isLight ? this.lightMat : this.darkMat);
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
    this.group.add(frame);
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
