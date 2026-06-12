import type { FastifyInstance } from 'fastify';
import { db, type GameRow } from './db.js';
import { requireUser } from './auth.js';

const MAX_GAMES_PER_USER = 200;
const gameBodySchema = {
  body: {
    type: 'object',
    required: ['name', 'pgn', 'config'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      pgn: { type: 'string', maxLength: 100_000 },
      config: { type: 'object' },
      result: { type: 'string', maxLength: 10 },
      moves: { type: 'integer', minimum: 0 },
    },
  },
} as const;

interface GameBody {
  name: string;
  pgn: string;
  config: unknown;
  result?: string;
  moves?: number;
}

const summary = (g: GameRow) => ({
  id: g.id,
  name: g.name,
  result: g.result,
  moves: g.moves,
  createdAt: g.created_at,
  updatedAt: g.updated_at,
});

function ownGame(userId: number, gameId: number): GameRow | undefined {
  return db
    .prepare('SELECT * FROM games WHERE id = ? AND user_id = ?')
    .get(gameId, userId) as GameRow | undefined;
}

export function gameRoutes(app: FastifyInstance): void {
  app.get('/api/games', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = db
      .prepare('SELECT * FROM games WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100')
      .all(user.id) as GameRow[];
    return rows.map(summary);
  });

  app.post('/api/games', { schema: gameBodySchema }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM games WHERE user_id = ?').get(user.id) as { n: number }
    ).n;
    if (count >= MAX_GAMES_PER_USER) {
      return reply.code(409).send({ error: 'limite-partidas' });
    }
    const body = req.body as GameBody;
    const info = db
      .prepare(
        'INSERT INTO games (user_id, name, pgn, config, result, moves) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(user.id, body.name, body.pgn, JSON.stringify(body.config), body.result ?? '*', body.moves ?? 0);
    return { id: Number(info.lastInsertRowid) };
  });

  app.get('/api/games/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const game = ownGame(user.id, Number((req.params as { id: string }).id));
    if (!game) return reply.code(404).send({ error: 'no-existe' });
    return { ...summary(game), pgn: game.pgn, config: JSON.parse(game.config) };
  });

  app.put('/api/games/:id', { schema: gameBodySchema }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const game = ownGame(user.id, Number((req.params as { id: string }).id));
    if (!game) return reply.code(404).send({ error: 'no-existe' });
    const body = req.body as GameBody;
    db.prepare(
      `UPDATE games SET name = ?, pgn = ?, config = ?, result = ?, moves = ?,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(body.name, body.pgn, JSON.stringify(body.config), body.result ?? '*', body.moves ?? 0, game.id);
    return { ok: true };
  });

  app.delete('/api/games/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const game = ownGame(user.id, Number((req.params as { id: string }).id));
    if (!game) return reply.code(404).send({ error: 'no-existe' });
    db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
    return { ok: true };
  });
}
