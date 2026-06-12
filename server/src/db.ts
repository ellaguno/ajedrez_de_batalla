import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(here, '..', 'data', 'adb.sqlite');
const dbPath = process.env.ADB_DB ?? defaultPath;
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  pass_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pgn TEXT NOT NULL,
  config TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '*',
  moves INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_models (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  base_url TEXT,
  model TEXT NOT NULL,
  api_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  white_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pgn TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  result TEXT NOT NULL DEFAULT '*',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Migración: columna de administrador en instalaciones previas.
const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (!userCols.some((c) => c.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

/** Correos designados administradores vía ADB_ADMIN_EMAIL (separados por coma). */
export function adminEmails(): string[] {
  return (process.env.ADB_ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

for (const email of adminEmails()) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
}

export interface UserRow {
  id: number;
  email: string;
  name: string | null;
  pass_hash: string;
  verified: number;
  is_admin: number;
}

export interface LlmModelRow {
  id: number;
  name: string;
  provider: 'openai' | 'anthropic' | 'mock';
  base_url: string | null;
  model: string;
  api_key: string | null;
  enabled: number;
}

export interface GameRow {
  id: number;
  user_id: number;
  name: string;
  pgn: string;
  config: string;
  result: string;
  moves: number;
  created_at: string;
  updated_at: string;
}
