import type { GameConfig } from './types';

const SAVE_KEY = 'adb.partida.v1';
const THEME_KEY = 'adb.tema';

export interface SavedGame {
  pgn: string;
  config: GameConfig;
  /** Nombre visible de la partida (se reutiliza al guardar en el servidor). */
  name?: string;
  /** Id de la misma partida en el servidor, si el usuario tiene sesión. */
  serverGameId?: number | null;
}

export function saveGame(data: SavedGame): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* almacenamiento lleno o bloqueado: se juega sin persistencia */
  }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedGame;
    if (typeof data.pgn !== 'string' || !data.config?.white || !data.config?.black) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  localStorage.removeItem(SAVE_KEY);
}

const SET_KEY = 'adb.set';

export function loadSetId(): string {
  return localStorage.getItem(SET_KEY) ?? 'guerreros';
}

export function saveSetId(id: string): void {
  localStorage.setItem(SET_KEY, id);
}

const CINE_KEY = 'adb.cinematicas';

export function loadCinematics(): boolean {
  return localStorage.getItem(CINE_KEY) !== 'off';
}

export function saveCinematics(enabled: boolean): void {
  localStorage.setItem(CINE_KEY, enabled ? 'on' : 'off');
}

const ONLINE_KEY = 'adb.online';

/** Código de la partida en línea activa (para reconectar tras recargar). */
export function loadOnlineCode(): string | null {
  return localStorage.getItem(ONLINE_KEY);
}

export function saveOnlineCode(code: string | null): void {
  if (code) localStorage.setItem(ONLINE_KEY, code);
  else localStorage.removeItem(ONLINE_KEY);
}

export type Theme = 'dark' | 'light';

export function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}
