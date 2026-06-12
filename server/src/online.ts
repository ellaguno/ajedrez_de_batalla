import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { Chess } from 'chess.js';
import { db } from './db.js';
import { currentUser } from './auth.js';

/**
 * Juego en línea persona contra persona. El servidor es el árbitro: mantiene
 * el estado autoritativo de cada partida, valida las jugadas con chess.js y
 * las difunde a ambos jugadores; los clientes solo aplican jugadas
 * confirmadas. Las partidas se identifican por un código de invitación y
 * sobreviven a reconexiones y reinicios del servidor (rehidratadas del PGN).
 */

type Color = 'w' | 'b';

interface Seat {
  userId: number;
  name: string;
  socket: WebSocket | null;
}

interface Match {
  id: number;
  code: string;
  chess: Chess;
  seats: Partial<Record<Color, Seat>>;
  status: 'open' | 'active' | 'finished';
  result: string;
}

interface MatchRow {
  id: number;
  code: string;
  white_id: number | null;
  black_id: number | null;
  pgn: string;
  status: string;
  result: string;
}

const matches = new Map<string, Match>();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  let code = '';
  do {
    code = Array.from(
      { length: 5 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('');
  } while (matches.has(code));
  return code;
}

function userName(userId: number): string {
  const row = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId) as
    | { name: string | null; email: string }
    | undefined;
  return row?.name || row?.email.split('@')[0] || 'Jugador';
}

function loadMatch(code: string): Match | null {
  const existing = matches.get(code);
  if (existing) return existing;
  const row = db
    .prepare(`SELECT * FROM matches WHERE code = ? AND status != 'finished'`)
    .get(code) as MatchRow | undefined;
  if (!row) return null;
  const chess = new Chess();
  if (row.pgn) {
    try {
      chess.loadPgn(row.pgn);
    } catch {
      return null;
    }
  }
  const match: Match = {
    id: row.id,
    code: row.code,
    chess,
    seats: {},
    status: row.status as Match['status'],
    result: row.result,
  };
  if (row.white_id) match.seats.w = { userId: row.white_id, name: userName(row.white_id), socket: null };
  if (row.black_id) match.seats.b = { userId: row.black_id, name: userName(row.black_id), socket: null };
  matches.set(code, match);
  return match;
}

function persist(match: Match): void {
  db.prepare(
    `UPDATE matches SET white_id = ?, black_id = ?, pgn = ?, status = ?, result = ?,
     updated_at = datetime('now') WHERE id = ?`,
  ).run(
    match.seats.w?.userId ?? null,
    match.seats.b?.userId ?? null,
    match.chess.pgn(),
    match.status,
    match.result,
    match.id,
  );
}

function send(socket: WebSocket | null | undefined, payload: unknown): void {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcast(match: Match, payload: unknown): void {
  send(match.seats.w?.socket, payload);
  send(match.seats.b?.socket, payload);
}

function gameOverReason(chess: Chess): string {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isThreefoldRepetition()) return 'threefold';
  if (chess.isInsufficientMaterial()) return 'insufficient';
  return 'fifty-moves';
}

function startPayload(match: Match, color: Color) {
  return {
    type: 'start',
    code: match.code,
    color,
    pgn: match.chess.pgn(),
    white: match.seats.w?.name ?? '?',
    black: match.seats.b?.name ?? '?',
    status: match.status,
    result: match.result,
  };
}

function seatOf(match: Match, userId: number): Color | null {
  if (match.seats.w?.userId === userId) return 'w';
  if (match.seats.b?.userId === userId) return 'b';
  return null;
}

export async function onlineRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get('/api/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const user = currentUser(req);
    if (!user) {
      send(socket, { type: 'error', code: 'no-autenticado' });
      socket.close();
      return;
    }

    let match: Match | null = null;
    let myColor: Color | null = null;

    const leaveCurrent = () => {
      if (match && myColor && match.seats[myColor]?.socket === socket) {
        match.seats[myColor]!.socket = null;
        const rival = match.seats[myColor === 'w' ? 'b' : 'w'];
        send(rival?.socket, { type: 'opponent-status', online: false });
      }
    };

    socket.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', code: 'mensaje-invalido' });
      }

      switch (msg.type) {
        case 'create': {
          leaveCurrent();
          const pick = msg.color === 'w' || msg.color === 'b'
            ? (msg.color as Color)
            : Math.random() < 0.5
              ? 'w'
              : 'b';
          const code = newCode();
          const info = db
            .prepare(`INSERT INTO matches (code, ${pick === 'w' ? 'white_id' : 'black_id'}) VALUES (?, ?)`)
            .run(code, user.id);
          match = {
            id: Number(info.lastInsertRowid),
            code,
            chess: new Chess(),
            seats: { [pick]: { userId: user.id, name: userName(user.id), socket } },
            status: 'open',
            result: '*',
          };
          myColor = pick;
          matches.set(code, match);
          return send(socket, { type: 'created', code, color: pick });
        }

        case 'join': {
          leaveCurrent();
          const code = String(msg.code ?? '').trim().toUpperCase();
          const m = loadMatch(code);
          if (!m) return send(socket, { type: 'error', code: 'partida-no-existe' });

          const seated = seatOf(m, user.id);
          if (seated) {
            // Reconexión del propio jugador.
            m.seats[seated]!.socket = socket;
            match = m;
            myColor = seated;
            send(socket, startPayload(m, seated));
            const rival = m.seats[seated === 'w' ? 'b' : 'w'];
            send(rival?.socket, { type: 'opponent-status', online: true });
            return;
          }
          if (m.status !== 'open') return send(socket, { type: 'error', code: 'partida-llena' });

          const free: Color = m.seats.w ? 'b' : 'w';
          m.seats[free] = { userId: user.id, name: userName(user.id), socket };
          m.status = 'active';
          persist(m);
          match = m;
          myColor = free;
          send(m.seats.w?.socket, startPayload(m, 'w'));
          send(m.seats.b?.socket, startPayload(m, 'b'));
          return;
        }

        case 'move': {
          if (!match || !myColor) return send(socket, { type: 'error', code: 'sin-partida' });
          if (match.status !== 'active') return send(socket, { type: 'error', code: 'partida-no-activa' });
          if (match.chess.turn() !== myColor) return send(socket, { type: 'error', code: 'no-es-tu-turno' });
          let move;
          try {
            move = match.chess.move({
              from: String(msg.from ?? ''),
              to: String(msg.to ?? ''),
              promotion: typeof msg.promotion === 'string' ? msg.promotion : 'q',
            });
          } catch {
            return send(socket, { type: 'error', code: 'jugada-ilegal' });
          }
          const over = match.chess.isGameOver();
          if (over) {
            match.status = 'finished';
            match.result = match.chess.isCheckmate()
              ? myColor === 'w'
                ? '1-0'
                : '0-1'
              : '1/2-1/2';
          }
          persist(match);
          broadcast(match, {
            type: 'move',
            san: move.san,
            from: move.from,
            to: move.to,
            promotion: move.promotion,
            fen: match.chess.fen(),
          });
          if (over) {
            broadcast(match, {
              type: 'game-over',
              result: match.result,
              reason: gameOverReason(match.chess),
            });
          }
          return;
        }

        case 'resign': {
          if (!match || !myColor || match.status !== 'active') return;
          match.status = 'finished';
          match.result = myColor === 'w' ? '0-1' : '1-0';
          persist(match);
          broadcast(match, {
            type: 'game-over',
            result: match.result,
            reason: 'resign',
            by: myColor,
          });
          return;
        }

        default:
          return send(socket, { type: 'error', code: 'tipo-desconocido' });
      }
    });

    socket.on('close', leaveCurrent);
  });
}
