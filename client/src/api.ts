import type { GameConfig } from './types';

/** Cliente de la API del servidor (cookies de sesión same-origin). */

export interface User {
  email: string;
  name: string | null;
  admin?: boolean;
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
  const res = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
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

export interface LlmModelInfo {
  id: number;
  name: string;
}

export interface LlmMove {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  attempts: number;
  /** true si el modelo no dio jugada legal y se usó una aleatoria. */
  fallback?: boolean;
}

export const llm = {
  models: () => call<LlmModelInfo[]>('GET', '/llm/models'),
  move: (modelId: number, fen: string, history: string[]) =>
    call<LlmMove>('POST', '/llm/move', { modelId, fen, history }),
};

export interface AdminLlmModel {
  id: number;
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string | null;
  model: string;
  hasKey: boolean;
  enabled: boolean;
}

export interface AdminLlmPayload {
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl?: string;
  model: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface UploadedSet {
  id: string;
  name: string;
  base: string;
}

export interface HdriInfo {
  id: string;
  name: string;
  url: string;
}

export async function listHdris(): Promise<HdriInfo[]> {
  try {
    const res = await fetch('/hdri/index.json');
    if (!res.ok) return [];
    const data = (await res.json()) as { hdris: HdriInfo[] };
    return Array.isArray(data.hdris) ? data.hdris : [];
  } catch {
    return [];
  }
}

export const admin = {
  llmList: () => call<AdminLlmModel[]>('GET', '/admin/llm'),
  llmCreate: (payload: AdminLlmPayload) => call<{ id: number }>('POST', '/admin/llm', payload),
  llmUpdate: (id: number, payload: AdminLlmPayload) =>
    call<{ ok: boolean }>('PUT', `/admin/llm/${id}`, payload),
  llmRemove: (id: number) => call<{ ok: boolean }>('DELETE', `/admin/llm/${id}`),
  setsList: () => call<UploadedSet[]>('GET', '/admin/sets'),
  setRemove: (id: string) => call<{ ok: boolean }>('DELETE', `/admin/sets/${id}`),
  hdriList: () => call<HdriInfo[]>('GET', '/admin/hdri'),
  hdriRemove: (file: string) => call<{ ok: boolean }>('DELETE', `/admin/hdri/${file}`),
  async hdriUpload(file: File): Promise<{ ok: boolean; id: string }> {
    const form = new FormData();
    form.append('archivo', file);
    const res = await fetch('/api/admin/hdri', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; id: string; error?: string }
      | null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `http-${res.status}`);
    return data!;
  },
  async setUpload(file: File): Promise<{ ok: boolean; id: string }> {
    const form = new FormData();
    form.append('archivo', file);
    const res = await fetch(`${import.meta.env.BASE_URL}api/admin/sets`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; id: string; error?: string; detail?: string }
      | null;
    if (!res.ok) {
      throw new ApiError(res.status, `${data?.error ?? `http-${res.status}`}${data?.detail ? `: ${data.detail}` : ''}`);
    }
    return data!;
  },
};

export const games = {
  list: () => call<GameSummary[]>('GET', '/games'),
  create: (payload: GamePayload) => call<{ id: number }>('POST', '/games', payload),
  update: (id: number, payload: GamePayload) =>
    call<{ ok: boolean }>('PUT', `/games/${id}`, payload),
  get: (id: number) => call<GameFull>('GET', `/games/${id}`),
  remove: (id: number) => call<{ ok: boolean }>('DELETE', `/games/${id}`),
};
