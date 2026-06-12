import type { GameConfig } from './types';

/** Cliente de la API del servidor (cookies de sesión same-origin). */

export interface User {
  email: string;
  name: string | null;
}

export interface GameSummary {
  id: number;
  name: string;
  result: string;
  moves: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameFull extends GameSummary {
  pgn: string;
  config: GameConfig;
}

export interface GamePayload {
  name: string;
  pgn: string;
  config: GameConfig;
  result?: string;
  moves?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status}: ${code}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // Sin body no se manda content-type: Fastify rechaza JSON vacío.
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuestas sin cuerpo */
  }
  if (!res.ok) {
    const code = (data as { error?: string } | null)?.error ?? `http-${res.status}`;
    throw new ApiError(res.status, code);
  }
  return data as T;
}

export const auth = {
  me: () => call<{ user: User | null }>('GET', '/auth/me'),
  register: (email: string, password: string, name?: string) =>
    call<{ ok: boolean; resent?: boolean }>('POST', '/auth/register', { email, password, name }),
  login: (email: string, password: string) =>
    call<User>('POST', '/auth/login', { email, password }),
  logout: () => call<{ ok: boolean }>('POST', '/auth/logout', {}),
  resend: (email: string, password: string) =>
    call<{ ok: boolean }>('POST', '/auth/resend', { email, password }),
};

export const games = {
  list: () => call<GameSummary[]>('GET', '/games'),
  create: (payload: GamePayload) => call<{ id: number }>('POST', '/games', payload),
  update: (id: number, payload: GamePayload) =>
    call<{ ok: boolean }>('PUT', `/games/${id}`, payload),
  get: (id: number) => call<GameFull>('GET', `/games/${id}`),
  remove: (id: number) => call<{ ok: boolean }>('DELETE', `/games/${id}`),
};
