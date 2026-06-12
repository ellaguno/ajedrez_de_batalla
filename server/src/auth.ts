import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, type UserRow } from './db.js';
import { sendMail } from './mailer.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

const SESSION_COOKIE = 'adb_session';
const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;

// ------------------------------------------------------------------ helpers
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 32);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const hash = await scrypt(password, salt, 32);
  const expected = Buffer.from(hex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function baseUrl(req: FastifyRequest): string {
  return process.env.BASE_URL ?? `${req.protocol}://${req.headers.host}`;
}

function createVerifyToken(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').run(userId, 'verify');
  db.prepare(
    `INSERT INTO tokens (user_id, kind, token_hash, expires_at)
     VALUES (?, 'verify', ?, datetime('now', '+${VERIFY_HOURS} hours'))`,
  ).run(userId, sha256(token));
  return token;
}

async function sendVerifyMail(req: FastifyRequest, user: UserRow): Promise<void> {
  const token = createVerifyToken(user.id);
  const link = `${baseUrl(req)}/api/auth/verify?token=${token}`;
  await sendMail(
    user.email,
    'Confirma tu cuenta — Ajedrez de Batalla',
    `¡Hola${user.name ? ` ${user.name}` : ''}!\n\n` +
      `Confirma tu cuenta de Ajedrez de Batalla abriendo este enlace:\n\n${link}\n\n` +
      `El enlace caduca en ${VERIFY_HOURS} horas. Si no creaste esta cuenta, ignora este correo.`,
  );
}

export function currentUser(req: FastifyRequest): UserRow | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(sha256(token)) as UserRow | undefined;
  return row ?? null;
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): UserRow | null {
  const user = currentUser(req);
  if (!user) {
    void reply.code(401).send({ error: 'no-autenticado' });
    return null;
  }
  return user;
}

// Limitador simple en memoria para los endpoints de credenciales.
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: FastifyRequest, max = 12, windowMs = 60_000): boolean {
  const key = `${req.ip}:${req.routeOptions.url}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}

// ------------------------------------------------------------------- rutas
const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
      name: { type: 'string', maxLength: 80 },
    },
  },
} as const;

export function authRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', { schema: credentialsSchema }, async (req, reply) => {
    if (rateLimited(req)) return reply.code(429).send({ error: 'demasiados-intentos' });
    const { email, password, name } = req.body as { email: string; password: string; name?: string };
    const normalized = email.trim().toLowerCase();

    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized) as
      | UserRow
      | undefined;
    if (existing) {
      if (!existing.verified) {
        await sendVerifyMail(req, existing);
        return { ok: true, resent: true };
      }
      return reply.code(409).send({ error: 'email-registrado' });
    }

    const passHash = await hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)')
      .run(normalized, name?.trim() || null, passHash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
    await sendVerifyMail(req, user);
    return { ok: true };
  });

  app.get('/api/auth/verify', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'token-requerido' });
    const row = db
      .prepare(
        `SELECT * FROM tokens WHERE token_hash = ? AND kind = 'verify' AND expires_at > datetime('now')`,
      )
      .get(sha256(token)) as { id: number; user_id: number } | undefined;
    if (!row) return reply.code(400).send({ error: 'token-invalido' });
    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(row.user_id);
    db.prepare('DELETE FROM tokens WHERE id = ?').run(row.id);
    return reply.redirect('/?verificado=1');
  });

  app.post('/api/auth/resend', { schema: credentialsSchema }, async (req, reply) => {
    if (rateLimited(req, 4)) return reply.code(429).send({ error: 'demasiados-intentos' });
    const { email, password } = req.body as { email: string; password: string };
    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    if (!user || !(await verifyPassword(password, user.pass_hash))) {
      return reply.code(401).send({ error: 'credenciales' });
    }
    if (user.verified) return { ok: true, verified: true };
    await sendVerifyMail(req, user);
    return { ok: true };
  });

  app.post('/api/auth/login', { schema: credentialsSchema }, async (req, reply) => {
    if (rateLimited(req)) return reply.code(429).send({ error: 'demasiados-intentos' });
    const { email, password } = req.body as { email: string; password: string };
    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    if (!user || !(await verifyPassword(password, user.pass_hash))) {
      return reply.code(401).send({ error: 'credenciales' });
    }
    if (!user.verified) return reply.code(403).send({ error: 'no-verificado' });

    const token = randomBytes(32).toString('base64url');
    db.prepare(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    ).run(user.id, sha256(token));
    db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();

    void reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_DAYS * 24 * 3600,
    });
    return { email: user.email, name: user.name };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // 200 con user:null para visitantes (un 401 aquí ensucia la consola del
  // navegador en cada arranque anónimo).
  app.get('/api/auth/me', async (req) => {
    const user = currentUser(req);
    return { user: user ? { email: user.email, name: user.name } : null };
  });
}
