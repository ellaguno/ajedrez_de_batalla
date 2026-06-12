import type { Chess, Move, Square, Color } from 'chess.js';

/** Lista plana de piezas de una posición. */
export function piecesOf(chess: Chess): { square: Square; type: Move['piece']; color: Color }[] {
  const out: { square: Square; type: Move['piece']; color: Color }[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (p) out.push({ square: p.square, type: p.type, color: p.color });
    }
  }
  return out;
}
