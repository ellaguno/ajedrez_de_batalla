import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, type LibraryRow } from './db.js';
import { requireAdmin } from './auth.js';
import {
  CATEGORIES,
  parseCollection,
  type LibraryCategory,
  type ParsedGame,
} from './pgn.js';

const here = dirname(fileURLToPath(import.meta.url));
// PGNs builtin versionados (fuera de server/data/, que está en .gitignore).
const builtinDir = join(here, '..', 'library', 'builtin');
const MAX_PGN_BYTES = 8 * 1024 * 1024;

const insertStmt = db.prepare(
  `INSERT INTO library_games
     (category, name, white, black, event, date, eco, result, moves, description, pgn, source, builtin)
   VALUES
     (@category, @name, @white, @black, @event, @date, @eco, @result, @moves, @description, @pgn, @source, @builtin)`,
);

const insertMany = db.transaction((games: ParsedGame[], source: string, builtin: number) => {
  for (const g of games) {
    insertStmt.run({ ...g, source, builtin });
  }
  return games.length;
});

/** Inserta partidas ya parseadas; devuelve cuántas se añadieron. */
export function importGames(games: ParsedGame[], source: string, builtin = 0): number {
  if (games.length === 0) return 0;
  return insertMany(games, source, builtin) as number;
}

/**
 * Resiembra la colección builtin desde server/data/library/builtin/*.pgn.
 * Idempotente: borra solo las filas builtin y las recrea, de modo que editar
 * los .pgn versionados actualiza el contenido sin tocar lo subido por admin.
 */
export function seedLibrary(): void {
  if (!existsSync(builtinDir)) return;
  const files = readdirSync(builtinDir).filter((f) => f.endsWith('.pgn'));
  const reseed = db.transaction(() => {
    db.prepare('DELETE FROM library_games WHERE builtin = 1').run();
    let total = 0;
    for (const file of files) {
      const fallback = file.replace(/\.pgn$/i, '') as LibraryCategory;
      const cat = CATEGORIES.includes(fallback) ? fallback : 'famous';
      const games = parseCollection(readFileSync(join(builtinDir, file), 'utf8'), cat);
      for (const g of games) insertStmt.run({ ...g, source: `builtin:${file}`, builtin: 1 });
      total += games.length;
    }
    return total;
  });
  const n = reseed() as number;
  console.log(`[library] ${n} partidas builtin sembradas`);
}

const summary = (r: LibraryRow) => ({
  id: r.id,
  category: r.category,
  name: r.name,
  white: r.white,
  black: r.black,
  event: r.event,
  date: r.date,
  eco: r.eco,
  result: r.result,
  moves: r.moves,
  description: r.description,
  builtin: !!r.builtin,
});

export function libraryRoutes(app: FastifyInstance): void {
  // Conteo por categoría (público): alimenta las pestañas de la biblioteca.
  app.get('/api/library/categories', async () => {
    const rows = db
      .prepare('SELECT category, COUNT(*) AS n FROM library_games GROUP BY category')
      .all() as { category: string; n: number }[];
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      counts[r.category] = r.n;
      total += r.n;
    }
    return { counts, total };
  });

  // Listado paginado y filtrable (público).
  app.get('/api/library', async (req) => {
    const q = req.query as {
      category?: string;
      q?: string;
      limit?: string;
      offset?: string;
      builtin?: string;
    };
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.category && CATEGORIES.includes(q.category as LibraryCategory)) {
      where.push('category = ?');
      params.push(q.category);
    }
    if (q.builtin === '0' || q.builtin === '1') {
      where.push('builtin = ?');
      params.push(Number(q.builtin));
    }
    if (q.q && q.q.trim()) {
      const like = `%${q.q.trim().slice(0, 80)}%`;
      where.push('(name LIKE ? OR white LIKE ? OR black LIKE ? OR event LIKE ? OR eco LIKE ?)');
      params.push(like, like, like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(q.limit) || 60, 1), 100);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM library_games ${clause}`).get(...params) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT * FROM library_games ${clause}
         ORDER BY builtin DESC, moves ASC, name ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as LibraryRow[];
    return { items: rows.map(summary), total, limit, offset };
  });

  // Partida completa con PGN (público): la consume el reproductor.
  app.get('/api/library/:id', async (req, reply) => {
    const row = db
      .prepare('SELECT * FROM library_games WHERE id = ?')
      .get(Number((req.params as { id: string }).id)) as LibraryRow | undefined;
    if (!row) return reply.code(404).send({ error: 'no-existe' });
    return { ...summary(row), pgn: row.pgn };
  });

  // --- Administración: subir/borrar partidas (requiere admin) ---

  // Sube un .pgn (una o varias partidas). La categoría llega por query.
  app.post('/api/admin/library', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = req.query as { category?: string };
    const category = (
      CATEGORIES.includes(q.category as LibraryCategory) ? q.category : 'famous'
    ) as LibraryCategory;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'archivo-requerido' });
    const buffer = await file.toBuffer();
    if (buffer.length > MAX_PGN_BYTES) return reply.code(413).send({ error: 'archivo-grande' });
    const games = parseCollection(buffer.toString('utf8'), category);
    if (games.length === 0) return reply.code(400).send({ error: 'sin-partidas-validas' });
    const source = `admin:${(file.filename ?? 'subido.pgn').slice(0, 80)}`;
    const added = importGames(games, source, 0);
    return { ok: true, added };
  });

  app.delete('/api/admin/library/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const info = db
      .prepare('DELETE FROM library_games WHERE id = ? AND builtin = 0')
      .run(Number((req.params as { id: string }).id));
    if (info.changes === 0) return reply.code(404).send({ error: 'no-existe-o-builtin' });
    return { ok: true };
  });

  // Borra en bloque por fuente (p.ej. una colección descargada de pgnmentor).
  app.delete('/api/admin/library', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const source = (req.query as { source?: string }).source;
    if (!source) return reply.code(400).send({ error: 'fuente-requerida' });
    const info = db
      .prepare('DELETE FROM library_games WHERE source = ? AND builtin = 0')
      .run(source);
    return { ok: true, removed: info.changes };
  });
}
