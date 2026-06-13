import { Chess } from 'chess.js';

export type LibraryCategory = 'famous' | 'educational' | 'endgame' | 'opening';
export const CATEGORIES: LibraryCategory[] = ['famous', 'educational', 'endgame', 'opening'];

export interface ParsedGame {
  category: LibraryCategory;
  name: string;
  white: string | null;
  black: string | null;
  event: string | null;
  date: string | null;
  eco: string | null;
  result: string;
  moves: number;
  description: string | null;
  pgn: string;
}

/** Lee un tag arbitrario (estándar o propio ADB*) directamente del texto PGN. */
function tag(pgn: string, name: string): string | undefined {
  const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`));
  const v = m?.[1]?.trim();
  return v ? v : undefined;
}

/**
 * Divide un PGN con varias partidas en bloques individuales. Cada partida
 * empieza en una línea `[Event ...]`; todo lo anterior a la primera se descarta.
 */
export function splitPgn(text: string): string[] {
  const norm = text.replace(/\r\n?/g, '\n');
  const starts: number[] = [];
  const re = /^\[Event\s/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) starts.push(m.index);
  if (starts.length === 0) {
    const t = norm.trim();
    return t ? [t] : [];
  }
  const out: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = norm.slice(starts[i], starts[i + 1] ?? norm.length).trim();
    if (chunk) out.push(chunk);
  }
  return out;
}

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/**
 * Valida una partida individual con chess.js y extrae sus metadatos. Devuelve
 * `null` si el PGN es ilegal o no contiene jugadas (así no se siembra basura).
 * `fallbackCategory` se usa si la partida no trae el tag propio `ADBCategory`.
 */
export function parseGame(pgn: string, fallbackCategory: LibraryCategory): ParsedGame | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const moves = chess.history().length;
  if (moves === 0) return null;

  const white = tag(pgn, 'White') ?? null;
  const black = tag(pgn, 'Black') ?? null;
  const event = tag(pgn, 'Event') ?? null;
  const eco = tag(pgn, 'ECO') ?? null;
  const date = tag(pgn, 'Date');
  const cleanDate = date && !/^\?+/.test(date) ? date.replace(/\.\?\?/g, '').replace(/\.$/, '') : null;

  const rawCat = tag(pgn, 'ADBCategory') as LibraryCategory | undefined;
  const category = rawCat && CATEGORIES.includes(rawCat) ? rawCat : fallbackCategory;

  const title = tag(pgn, 'ADBTitle');
  const name =
    title ??
    (white && black ? `${white} – ${black}` : event ?? white ?? black ?? 'Partida sin título');

  const resultTag = tag(pgn, 'Result');
  const result = resultTag && RESULTS.has(resultTag) ? resultTag : '*';

  return {
    category,
    name: name.slice(0, 160),
    white,
    black,
    event,
    date: cleanDate,
    eco,
    result,
    moves,
    description: tag(pgn, 'ADBDescription') ?? null,
    pgn: pgn.trim(),
  };
}

/** Parsea un archivo/texto con una o varias partidas, descartando las inválidas. */
export function parseCollection(text: string, fallbackCategory: LibraryCategory): ParsedGame[] {
  const out: ParsedGame[] = [];
  for (const block of splitPgn(text)) {
    const g = parseGame(block, fallbackCategory);
    if (g) out.push(g);
  }
  return out;
}
