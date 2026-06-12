import * as THREE from 'three';
import type { Square, Color } from 'chess.js';
import type { AppliedMove } from '../types';
import type { PieceSet, PieceType } from '../sets/types';
import { PieceActor } from '../sets/PieceActor';
import { classicSet } from '../sets/classic';
import { sfx } from './audio';
import { squareToWorld } from './board';
import { Tweens, easeOutCubic } from './tweens';

/** Velocidad de desplazamiento, en casillas por segundo. */
const WALK_SPEED = 2.2;

export class Pieces3D {
  readonly group = new THREE.Group();
  private bySquare = new Map<string, PieceActor>();
  /** Actores fuera del tablero lógico pero aún animándose (víctimas muriendo). */
  private dying = new Set<PieceActor>();
  private set: PieceSet = classicSet();

  constructor(private tweens: Tweens) {}

  setPieceSet(set: PieceSet): void {
    this.set = set;
  }

  /** Reconstruye todas las piezas desde el estado del juego. */
  sync(pieces: { square: Square; type: PieceType; color: Color }[]): void {
    for (const actor of this.bySquare.values()) actor.dispose();
    for (const actor of this.dying) actor.dispose();
    this.group.clear();
    this.bySquare.clear();
    this.dying.clear();
    for (const p of pieces) {
      const actor = this.spawn(p.type, p.color, p.square);
      actor.playLoop('idle', true);
    }
  }

  /** Avanza los mixers de animación; llamado desde el bucle de render. */
  update(dt: number): void {
    for (const actor of this.bySquare.values()) actor.update(dt);
    for (const actor of this.dying) actor.update(dt);
  }

  squareOf(object: THREE.Object3D): string | null {
    let o: THREE.Object3D | null = object;
    while (o) {
      if (typeof o.userData.square === 'string') return o.userData.square;
      o = o.parent;
    }
    return null;
  }

  /**
   * Anima una jugada validada. En capturas: el atacante camina hasta casi
   * la casilla, golpea (clip attack), la víctima cae (clip die) y entonces
   * ocupa la casilla. Los sets sin clips usan fundidos/tweens equivalentes.
   * El hito 3 añadirá la cámara cinematográfica sobre esta misma secuencia.
   */
  async animateMove(applied: AppliedMove): Promise<void> {
    const { move } = applied;
    const attacker = this.bySquare.get(move.from);
    if (!attacker) return;

    let victimSquare: string | null = null;
    if (move.flags.includes('e')) victimSquare = move.to[0] + move.from[1];
    else if (move.captured) victimSquare = move.to;
    const victim = victimSquare ? this.bySquare.get(victimSquare) : undefined;
    if (victimSquare) this.bySquare.delete(victimSquare);
    if (victim) this.dying.add(victim);

    // Reasignar el mapa de inmediato: el estado lógico ya cambió.
    this.bySquare.delete(move.from);
    this.bySquare.set(move.to, attacker);
    attacker.root.userData.square = move.to;

    const from = squareToWorld(move.from);
    const to = squareToWorld(victim ? (victimSquare as string) : move.to);
    const arc = move.piece === 'n' ? 0.45 : 0;

    // El caminante mira hacia donde va.
    this.face(attacker, from, to);

    const castling = this.startCastlingRook(move);

    if (victim) {
      const near = from.clone().lerp(to, 1 - 0.62 / from.distanceTo(to));
      attacker.playLoop('walk');
      sfx.slide();
      await this.slide(attacker, from, near, arc);

      const attack = attacker.has('attack')
        ? attacker.playOnce('attack')
        : this.tweens.run(0.5, (k) => {
            attacker.root.position.copy(near).lerp(to, Math.sin(Math.PI * k) * 0.3);
          });
      const death = this.tweens
        .delay(0.3)
        .then(() => {
          sfx.clash();
          return victim.has('die') ? victim.playOnce('die') : Promise.resolve();
        })
        .then(() => {
          sfx.fall();
          return this.sinkAndRemove(victim);
        });
      await Promise.all([attack, death]);

      attacker.playLoop('walk');
      await this.slide(attacker, near, squareToWorld(move.to), 0);
    } else {
      attacker.playLoop('walk');
      sfx.slide();
      await this.slide(attacker, from, squareToWorld(move.to), arc);
    }

    sfx.knock();
    attacker.playLoop('idle');
    this.faceHome(attacker, move.color);
    await castling;

    if (move.promotion) {
      attacker.dispose();
      this.bySquare.delete(move.to);
      const promoted = this.spawn(move.promotion as PieceType, move.color, move.to as Square);
      promoted.root.scale.setScalar(0.001);
      await this.tweens.run(0.3, (k) => promoted.root.scale.setScalar(Math.max(0.001, k)));
      void promoted.playOnce('win').then(() => promoted.playLoop('idle'));
    }
  }

  private spawn(type: PieceType, color: Color, square: Square): PieceActor {
    const actor = this.set.createPiece(type, color);
    actor.root.position.copy(squareToWorld(square));
    actor.root.userData.square = square;
    actor.root.userData.color = color;
    this.group.add(actor.root);
    this.bySquare.set(square, actor);
    return actor;
  }

  private slide(actor: PieceActor, a: THREE.Vector3, b: THREE.Vector3, arc: number): Promise<void> {
    const dist = a.distanceTo(b);
    const duration = Math.max(0.25, dist / WALK_SPEED);
    return this.tweens.run(duration, (k) => {
      actor.root.position.lerpVectors(a, b, k);
      if (arc > 0) actor.root.position.y = Math.sin(Math.PI * k) * arc;
    });
  }

  private startCastlingRook(move: AppliedMove['move']): Promise<void> {
    if (!move.flags.includes('k') && !move.flags.includes('q')) return Promise.resolve();
    const rank = move.color === 'w' ? '1' : '8';
    const [rookFrom, rookTo] = move.flags.includes('k')
      ? [`h${rank}`, `f${rank}`]
      : [`a${rank}`, `d${rank}`];
    const rook = this.bySquare.get(rookFrom);
    if (!rook) return Promise.resolve();
    this.bySquare.delete(rookFrom);
    this.bySquare.set(rookTo, rook);
    rook.root.userData.square = rookTo;
    const a = squareToWorld(rookFrom);
    const b = squareToWorld(rookTo);
    this.face(rook, a, b);
    rook.playLoop('walk');
    return this.slide(rook, a, b, 0).then(() => {
      rook.playLoop('idle');
      this.faceHome(rook, move.color);
    });
  }

  /** La víctima cae y se hunde bajo el tablero. */
  private sinkAndRemove(victim: PieceActor): Promise<void> {
    const hasDie = victim.has('die');
    const start = victim.root.position.clone();
    return this.tweens
      .run(hasDie ? 0.6 : 0.5, (k) => {
        victim.root.position.y = start.y - 0.6 * k;
        if (!hasDie) {
          victim.root.scale.setScalar(Math.max(0.001, 1 - k));
          victim.root.rotation.z = k * 0.9;
        }
      }, easeOutCubic)
      .then(() => {
        this.dying.delete(victim);
        victim.dispose();
      });
  }

  private face(actor: PieceActor, from: THREE.Vector3, to: THREE.Vector3): void {
    if (from.distanceToSquared(to) < 1e-6) return;
    const angle = Math.atan2(to.x - from.x, to.z - from.z);
    // El modelo interior ya viene orientado por color (+z o -z); el root
    // compensa esa rotación base para que el total mire hacia el destino.
    const inner = actor.root.children[0];
    actor.root.rotation.y = angle - (inner?.rotation.y ?? 0);
  }

  /** Vuelve a la orientación de reposo (mirando al rival). */
  private faceHome(actor: PieceActor, _color: Color): void {
    actor.root.rotation.y = 0;
  }
}
