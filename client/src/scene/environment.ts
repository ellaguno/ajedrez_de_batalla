import * as THREE from 'three';
import { stoneTexture, woodTexture } from './textures';

/**
 * Entorno del tablero: mesa de madera sobre pedestal de piedra, suelo de
 * sillería, anillo de columnas y antorchas con llama y luz parpadeante.
 * Todo procedural; en el tema claro la piedra se aclara y las antorchas
 * se atenúan.
 */

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  halo: THREE.Mesh;
  phase: number;
}

const THEME = {
  dark: { stone: 0x57534e, floor: 0x3b3733, torch: 6.5, flame: 1.0 },
  light: { stone: 0xcfc8bd, floor: 0xbdb5a8, torch: 2.2, flame: 0.85 },
};

export class Environment {
  readonly group = new THREE.Group();
  private torches: Torch[] = [];
  private stoneMats: THREE.MeshStandardMaterial[] = [];
  private floorMat: THREE.MeshStandardMaterial;
  private theme: 'dark' | 'light' = 'dark';
  private time = 0;

  constructor() {
    const wood = woodTexture(4242);
    wood.repeat.set(6, 6);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x5a3d26,
      map: wood,
      roughness: 0.5,
      metalness: 0.05,
    });

    const stone = stoneTexture(31, 256, false);
    stone.repeat.set(3, 2);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: THEME.dark.stone,
      map: stone,
      roughness: 0.9,
    });
    const floorTex = stoneTexture(77, 512, true);
    floorTex.repeat.set(10, 10);
    this.floorMat = new THREE.MeshStandardMaterial({
      color: THEME.dark.floor,
      map: floorTex,
      roughness: 0.95,
    });
    this.stoneMats.push(stoneMat);

    // Mesa bajo el tablero (la cara superior toca la base del marco).
    const table = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.7, 0.55, 48), tableMat);
    table.position.y = -0.53;
    table.receiveShadow = true;
    this.group.add(table);
    const tableRim = new THREE.Mesh(new THREE.TorusGeometry(7.45, 0.09, 10, 48), tableMat);
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.y = -0.27;
    this.group.add(tableRim);

    // Pedestal de piedra y suelo.
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 1.3, 24), stoneMat);
    pedestal.position.y = -1.45;
    this.group.add(pedestal);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(46, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.1;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Anillo de columnas con basa y capitel.
    const shaftGeo = new THREE.CylinderGeometry(0.55, 0.65, 7.5, 14);
    const baseGeo = new THREE.BoxGeometry(1.7, 0.5, 1.7);
    const capGeo = new THREE.BoxGeometry(1.6, 0.45, 1.6);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(angle) * 14;
      const z = Math.sin(angle) * 14;
      const shaft = new THREE.Mesh(shaftGeo, stoneMat);
      shaft.position.set(x, -2.1 + 3.75 + 0.4, z);
      const base = new THREE.Mesh(baseGeo, stoneMat);
      base.position.set(x, -1.85, z);
      const cap = new THREE.Mesh(capGeo, stoneMat);
      cap.position.set(x, -2.1 + 7.5 + 0.6, z);
      this.group.add(shaft, base, cap);
    }

    // Antorchas en las cuatro esquinas de la mesa.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 });
    const cupMat = new THREE.MeshStandardMaterial({
      color: 0x6b6258,
      roughness: 0.5,
      metalness: 0.5,
    });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const x = 5.9 * sx;
      const z = 5.9 * sz;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 10), poleMat);
      pole.position.set(x, -0.25 + 0.8, z);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.1, 0.24, 10), cupMat);
      cup.position.set(x, 0.62, z);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.42, 10),
        new THREE.MeshBasicMaterial({ color: 0xffb43c }),
      );
      flame.position.set(x, 0.95, z);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0xff7a1a,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );
      halo.position.set(x, 0.9, z);

      const light = new THREE.PointLight(0xff9540, THEME.dark.torch, 11, 1.6);
      light.position.set(x, 1.05, z);

      this.group.add(pole, cup, flame, halo, light);
      this.torches.push({ light, flame, halo, phase: (x + z * 0.7) * 1.3 });
    }
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    const t = THEME[theme];
    for (const m of this.stoneMats) m.color.setHex(t.stone);
    this.floorMat.color.setHex(t.floor);
  }

  /** Parpadeo de las antorchas. */
  update(dt: number): void {
    this.time += dt;
    const t = THEME[this.theme];
    for (const torch of this.torches) {
      const n =
        Math.sin(this.time * 9 + torch.phase) * 0.5 +
        Math.sin(this.time * 23 + torch.phase * 2.7) * 0.3 +
        Math.sin(this.time * 4.2 + torch.phase * 0.6) * 0.2;
      torch.light.intensity = t.torch * (1 + n * 0.22);
      const s = t.flame * (1 + n * 0.16);
      torch.flame.scale.set(s, t.flame * (1 + n * 0.3), s);
      (torch.halo.material as THREE.MeshBasicMaterial).opacity = 0.28 + n * 0.1;
    }
  }
}
