import type { Move } from 'chess.js';

export type PlayerKind = 'human' | 'engine' | 'llm';

export interface PlayerConfig {
  kind: PlayerKind;
  /** Skill Level de Stockfish (0–20), solo para kind === 'engine'. */
  skill?: number;
  /** Id del modelo LLM en el servidor, solo para kind === 'llm'. */
  modelId?: number;
  /** Nombre visible del modelo LLM (se persiste con la partida). */
  label?: string;
}

export interface GameConfig {
  white: PlayerConfig;
  black: PlayerConfig;
}

/** Jugada ya aplicada, con el estado resultante. */
export interface AppliedMove {
  move: Move;
  check: boolean;
  gameOver: boolean;
}

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-moves'
  | 'draw';

export interface GameOverInfo {
  reason: GameOverReason;
  /** Color ganador en jaque mate; null en tablas. */
  winner: 'w' | 'b' | null;
}
