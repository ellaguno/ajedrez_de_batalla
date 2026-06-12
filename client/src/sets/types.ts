import type { Move, Color } from 'chess.js';
import type { PieceActor } from './PieceActor';

export type PieceType = Move['piece'];

/** Clips canónicos que el juego sabe usar; un set puede traer un subconjunto. */
export type ClipKey = 'idle' | 'walk' | 'attack' | 'die' | 'win';

export interface BoardStyle {
  light: string;
  dark: string;
  frame: string;
}

/** Entrada del catálogo /sets/index.json. */
export interface PieceSetInfo {
  id: string;
  name: string;
  /** Subdirectorio bajo /sets/ con set.json y modelos. Ausente en sets builtin. */
  dir?: string;
  /** Ruta base absoluta (sets subidos por el administrador, p. ej. /usersets/x). */
  base?: string;
  builtin?: boolean;
}

/** Manifiesto set.json de un set basado en archivos. */
export interface SetManifest {
  format: number;
  id: string;
  name: string;
  pieces: Record<PieceType, { model: string }>;
  /** clip canónico → nombre del clip dentro de los GLB. */
  clips: Partial<Record<ClipKey, string>>;
  colors: Record<Color, string>;
  scale?: number;
  board?: BoardStyle;
}

/** Set cargado y listo para instanciar piezas. */
export interface PieceSet {
  id: string;
  name: string;
  board?: BoardStyle;
  createPiece(type: PieceType, color: Color): PieceActor;
}
