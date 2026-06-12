import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { Square, Color } from 'chess.js';
import type { Move } from 'chess.js';
import type { AppliedMove } from '../types';
import type { PieceSet } from '../sets/types';
import { Board3D, squareToWorld, type HighlightKind } from './board';
import { Environment } from './environment';
import { Pieces3D } from './pieces';
import { Tweens } from './tweens';

const THEMES = {
  dark: { background: 0x131017, fog: 0x131017, hemi: 0.42, sun: 1.8, sunColor: 0xffe3bb },
  light: { background: 0xd9d2c4, fog: 0xd9d2c4, hemi: 0.85, sun: 2.4, sunColor: 0xfff2dd },
};

const UP = new THREE.Vector3(0, 1, 0);

export class SceneManager {
  /** Notifica a la UI cuándo hay una cinemática en curso (botón "saltar"). */
  onCinematicChange: ((active: boolean) => void) | null = null;
  cinematicsEnabled = true;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private environment = new Environment();
  private board = new Board3D();
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private currentTheme: 'dark' | 'light' = 'dark';
  /** 'sala' (entorno 3D) o URL de un HDRI equirectangular. */
  private backdrop = 'sala';
  private hdrCache = new Map<string, { background: THREE.Texture; env: THREE.Texture }>();
  private tweens = new Tweens();
  private pieces = new Pieces3D(this.tweens);

  /** Multiplicador de tiempo de animación (sube al saltar una cinemática). */
  private speed = 1;
  private inCinematic = false;
  private skipRequested = false;
  private skipResolvers: (() => void)[] = [];
  private drift: ((dt: number) => void) | null = null;
  private lookTarget = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 8.5, 9.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 24;
    this.controls.enablePan = false;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.85);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.sun.position.set(6, 12, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -7;
    this.sun.shadow.camera.right = 7;
    this.sun.shadow.camera.top = 7;
    this.sun.shadow.camera.bottom = -7;
    this.scene.add(this.hemi, this.sun);

    this.scene.fog = new THREE.Fog(THEMES.dark.fog, 26, 60);
    this.scene.add(this.environment.group, this.board.group, this.pieces.group);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.renderer.setAnimationLoop(() => {
      // Tope amplio: con FPS bajos (equipos modestos) las animaciones deben
      // seguir durando su tiempo real, no estirarse.
      const dt = Math.min(this.clock.getDelta(), 0.25) * this.speed;
      this.tweens.tick(dt);
      this.pieces.update(dt);
      this.environment.update(dt);
      this.drift?.(dt);
      if (this.inCinematic) {
        this.camera.lookAt(this.lookTarget);
      } else {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Activa un set de piezas: estilo de tablero + fábrica de actores. */
  applySet(set: PieceSet): void {
    this.board.applyStyle(set.board);
    this.pieces.setPieceSet(set);
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.currentTheme = theme;
    const t = THEMES[theme];
    if (this.backdrop === 'sala') {
      this.scene.background = new THREE.Color(t.background);
      this.scene.fog = new THREE.Fog(t.fog, 26, 60);
    }
    this.hemi.intensity = t.hemi;
    this.sun.intensity = t.sun;
    this.sun.color.setHex(t.sunColor);
    this.environment.setTheme(theme);
  }

  /**
   * Cambia el fondo: 'sala' restaura el entorno 3D; una URL .hdr carga un
   * panorama equirectangular que además ilumina la escena (PMREM).
   */
  async setBackdrop(value: string): Promise<void> {
    if (value === 'sala') {
      this.backdrop = 'sala';
      this.environment.group.visible = true;
      this.scene.environment = null;
      this.setTheme(this.currentTheme);
      return;
    }
    let entry = this.hdrCache.get(value);
    if (!entry) {
      const texture = await new RGBELoader().loadAsync(value);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(texture).texture;
      pmrem.dispose();
      entry = { background: texture, env };
      this.hdrCache.set(value, entry);
    }
    this.backdrop = value;
    this.environment.group.visible = false;
    this.scene.background = entry.background;
    this.scene.environment = entry.env;
    this.scene.fog = null;
  }

  syncPieces(pieces: { square: Square; type: Move['piece']; color: Color }[]): void {
    this.pieces.sync(pieces);
  }

  async animateMove(applied: AppliedMove): Promise<void> {
    const animation = this.pieces.animateMove(applied);
    if (applied.move.captured && this.cinematicsEnabled) {
      await Promise.all([this.cinematic(applied, animation), animation]);
    } else {
      await animation;
    }
    this.speed = 1;
  }

  /** Salta la cinemática en curso: la cámara vuelve y la acción se acelera. */
  requestSkip(): void {
    if (!this.inCinematic) return;
    this.skipRequested = true;
    const resolvers = this.skipResolvers;
    this.skipResolvers = [];
    for (const r of resolvers) r();
  }

  setHighlights(map: Map<string, HighlightKind>): void {
    this.board.setHighlights(map);
  }

  /** Casilla bajo el puntero, o null. */
  pickSquare(event: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [this.pieces.group, ...this.board.squareMeshes],
      true,
    );
    for (const hit of hits) {
      const fromPiece = this.pieces.squareOf(hit.object);
      if (fromPiece) return fromPiece;
      if (typeof hit.object.userData.square === 'string') return hit.object.userData.square;
    }
    return null;
  }

  /** Gira la cámara 180° para ver el tablero desde el otro bando. */
  async flipView(): Promise<void> {
    if (this.inCinematic) return;
    const start = this.camera.position.clone();
    await this.tweens.run(0.7, (k) => {
      this.camera.position.copy(start.clone().applyAxisAngle(UP, Math.PI * k));
    });
  }

  /** Coordenadas de pantalla (cliente) del centro de una casilla; para pruebas. */
  projectSquare(square: string): { x: number; y: number } {
    const p = squareToWorld(square).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** Posición actual de la cámara; para pruebas. */
  cameraPosition(): [number, number, number] {
    return this.camera.position.toArray() as [number, number, number];
  }

  // ----------------------------------------------------------- cinemática
  /**
   * Coreografía de cámara de un combate: vuelo a un plano lateral bajo del
   * duelo, travelling orbital lento mientras dura la acción y retorno a la
   * vista del jugador. `action` es la animación de piezas en curso.
   */
  private async cinematic(applied: AppliedMove, action: Promise<void>): Promise<void> {
    const move = applied.move;
    this.inCinematic = true;
    this.skipRequested = false;
    this.controls.enabled = false;
    this.onCinematicChange?.(true);

    const savedPos = this.camera.position.clone();
    const savedTarget = this.controls.target.clone();
    this.lookTarget.copy(savedTarget);

    // Encuadre: el combate ocurre junto a la víctima (el atacante se detiene
    // a ~0.6 de ella), así que se centra ahí — no en el camino recorrido,
    // que en capturas largas dejaba el duelo fuera de cuadro.
    const from = squareToWorld(move.from);
    const victimSquare = move.flags.includes('e') ? move.to[0] + move.from[1] : move.to;
    const victim = squareToWorld(victimSquare);
    const dir = victim.clone().sub(from).normalize();
    const duelCenter = victim.clone().sub(dir.clone().multiplyScalar(0.31));

    // Cámara perpendicular al ataque, del lado del espectador…
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    if (perp.dot(savedPos.clone().sub(victim)) < 0) perp.negate();
    // …y en la orilla, sesgada hacia fuera del tablero para no quedar
    // encajonada entre las piezas y mantener el duelo bien centrado.
    const camDir = perp.clone();
    const outward = duelCenter.clone().setY(0);
    if (outward.lengthSq() > 4) {
      camDir.multiplyScalar(0.75).add(outward.normalize().multiplyScalar(0.55)).normalize();
    }
    const duelPos = duelCenter
      .clone()
      .add(camDir.multiplyScalar(2.5))
      .add(new THREE.Vector3(0, 1.4, 0));
    const duelLook = duelCenter.clone().setY(0.35);

    // Vuelo de entrada.
    const p0 = savedPos.clone();
    const t0 = this.lookTarget.clone();
    await this.tweens.run(0.7, (k) => {
      this.camera.position.lerpVectors(p0, duelPos, k);
      this.lookTarget.lerpVectors(t0, duelLook, k);
    });

    // Travelling orbital lento hasta que termine la acción (o se salte).
    let angle = 0;
    this.drift = (dt) => {
      angle += dt * 0.14;
      this.camera.position.copy(
        duelPos.clone().sub(duelLook).applyAxisAngle(UP, angle).add(duelLook),
      );
    };
    await Promise.race([action, this.waitForSkip()]);
    this.drift = null;
    this.skipResolvers = [];
    if (this.skipRequested) this.speed = 4; // remata rápido la acción restante

    // Vuelo de salida.
    const p1 = this.camera.position.clone();
    const t1 = this.lookTarget.clone();
    await this.tweens.run(0.6, (k) => {
      this.camera.position.lerpVectors(p1, savedPos, k);
      this.lookTarget.lerpVectors(t1, savedTarget, k);
    });

    this.camera.lookAt(savedTarget);
    this.controls.enabled = true;
    this.inCinematic = false;
    this.onCinematicChange?.(false);
  }

  private waitForSkip(): Promise<void> {
    return new Promise((resolve) => this.skipResolvers.push(resolve));
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
