import { Chess } from 'chess.js';
import type { Move, Square, Color } from 'chess.js';
import { EnginePlayer } from './engine';
import { piecesOf } from './util';
import type { AppliedMove, GameConfig, GameOverInfo, PlayerConfig } from '../types';

export interface GameEvents {
  /** La vista anima la jugada; el controlador espera a que termine. */
  onMoveApplied(applied: AppliedMove): Promise<void>;
  /** La posición cambió sin jugada animable (nueva partida, deshacer). */
  onPositionReset(): void;
  /** Cualquier cambio de estado: turno, lista de jugadas, guardado. */
  onStateChanged(): void;
  onGameOver(info: GameOverInfo): void;
}

export class GameController {
  readonly chess = new Chess();
  config: GameConfig = { white: { kind: 'human' }, black: { kind: 'human' } };
  /** Hay un motor calculando o una animación en curso. */
  busy = false;

  private engines = new Map<Color, EnginePlayer>();
  /** Invalida bucles de motor pendientes al reiniciar/deshacer. */
  private generation = 0;

  constructor(private events: GameEvents) {}

  async newGame(config: GameConfig, pgn?: string): Promise<void> {
    this.generation++;
    this.busy = false;
    this.config = config;
    for (const e of this.engines.values()) e.dispose();
    this.engines.clear();

    this.chess.reset();
    if (pgn) {
      try {
        this.chess.loadPgn(pgn);
      } catch (err) {
        console.error('PGN guardado inválido, se inicia de cero', err);
        this.chess.reset();
      }
    }

    this.events.onPositionReset();
    this.events.onStateChanged();
    const over = this.gameOverInfo();
    if (over) {
      this.events.onGameOver(over);
      return;
    }
    void this.engineLoop(this.generation);
  }

  playerFor(color: Color): PlayerConfig {
    return color === 'w' ? this.config.white : this.config.black;
  }

  get turn(): Color {
    return this.chess.turn();
  }

  isHumanTurn(): boolean {
    return !this.chess.isGameOver() && this.playerFor(this.turn).kind === 'human';
  }

  pieces(): { square: Square; type: Move['piece']; color: Color }[] {
    return piecesOf(this.chess);
  }

  /** Detiene cualquier bucle de motor pendiente (p. ej. al entrar en repetición). */
  halt(): void {
    this.generation++;
    this.busy = false;
  }

  legalTargets(from: Square): Move[] {
    return this.chess.moves({ square: from, verbose: true });
  }

  /** ¿La jugada from→to es una promoción de peón? */
  needsPromotion(from: Square, to: Square): boolean {
    return this.legalTargets(from).some((m) => m.to === to && m.promotion);
  }

  async makeHumanMove(from: Square, to: Square, promotion?: string): Promise<boolean> {
    if (this.busy || !this.isHumanTurn()) return false;
    const legal = this.legalTargets(from).some(
      (m) => m.to === to && (!m.promotion || m.promotion === (promotion ?? 'q')),
    );
    if (!legal) return false;
    await this.applyMove(from, to, promotion);
    void this.engineLoop(this.generation);
    return true;
  }

  /** Deshacer (solo si juega al menos un humano). Retrocede hasta dejar al humano al turno. */
  undo(): void {
    if (this.busy) return;
    if (this.config.white.kind === 'engine' && this.config.black.kind === 'engine') return;
    if (this.chess.history().length === 0) return;

    this.generation++;
    this.chess.undo();
    // Si ahora le toca al motor (deshicimos su respuesta), quita también la jugada humana.
    while (this.chess.history().length > 0 && this.playerFor(this.turn).kind === 'engine') {
      this.chess.undo();
    }
    this.events.onPositionReset();
    this.events.onStateChanged();
    void this.engineLoop(this.generation);
  }

  gameOverInfo(): GameOverInfo | null {
    const c = this.chess;
    if (!c.isGameOver()) return null;
    if (c.isCheckmate()) return { reason: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { reason: 'stalemate', winner: null };
    if (c.isThreefoldRepetition()) return { reason: 'threefold', winner: null };
    if (c.isInsufficientMaterial()) return { reason: 'insufficient', winner: null };
    if (c.isDraw()) return { reason: 'fifty-moves', winner: null };
    return { reason: 'draw', winner: null };
  }

  serialize(): { pgn: string; config: GameConfig } {
    return { pgn: this.chess.pgn(), config: this.config };
  }

  private async applyMove(from: Square, to: Square, promotion?: string): Promise<void> {
    this.busy = true;
    try {
      const move = this.chess.move({ from, to, promotion: promotion ?? 'q' });
      const over = this.gameOverInfo();
      const applied: AppliedMove = {
        move,
        check: this.chess.isCheck(),
        gameOver: over !== null,
      };
      await this.events.onMoveApplied(applied);
      this.events.onStateChanged();
      if (over) this.events.onGameOver(over);
    } finally {
      this.busy = false;
    }
  }

  private async engineLoop(gen: number): Promise<void> {
    while (gen === this.generation && !this.chess.isGameOver()) {
      const color = this.turn;
      const player = this.playerFor(color);
      if (player.kind !== 'engine') return;

      this.busy = true;
      try {
        const engine = await this.engineFor(color, player.skill ?? 5);
        const skill = player.skill ?? 5;
        const mv = await engine.bestMove(this.chess.fen(), 200 + skill * 40);
        if (gen !== this.generation) return;
        this.busy = false;
        await this.applyMove(mv.from as Square, mv.to as Square, mv.promotion);
      } catch (err) {
        console.error('Fallo del motor', err);
        return;
      } finally {
        this.busy = false;
      }
      // Pausa breve entre jugadas para que IA vs IA sea seguible.
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async engineFor(color: Color, skill: number): Promise<EnginePlayer> {
    let engine = this.engines.get(color);
    if (!engine) {
      engine = new EnginePlayer();
      this.engines.set(color, engine);
      await engine.init();
    }
    engine.setSkill(skill);
    return engine;
  }
}
