/**
 * Cliente del juego en línea. Mantiene la conexión WebSocket con el árbitro;
 * todas las jugadas (propias y rivales) llegan confirmadas por el servidor.
 */

export interface StartInfo {
  code: string;
  color: 'w' | 'b';
  pgn: string;
  white: string;
  black: string;
  status: 'open' | 'active' | 'finished';
  result: string;
}

export interface OnlineEvents {
  onStart(info: StartInfo): void;
  onMove(mv: { san: string; from: string; to: string; promotion?: string }): void;
  onGameOver(info: { result: string; reason: string; by?: 'w' | 'b' }): void;
  onOpponentStatus(online: boolean): void;
  onError(code: string): void;
  /** La conexión se cerró (red caída o sesión inválida). */
  onClosed(): void;
}

const ERRORES: Record<string, string> = {
  'no-autenticado': 'Inicia sesión para jugar en línea.',
  'partida-no-existe': 'No existe ninguna partida con ese código.',
  'partida-llena': 'Esa partida ya tiene dos jugadores.',
  'jugada-ilegal': 'El servidor rechazó la jugada.',
  'no-es-tu-turno': 'No es tu turno.',
};

export function onlineErrorText(code: string): string {
  return ERRORES[code] ?? `Error de juego en línea (${code}).`;
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private pendingCreate: ((info: { code: string; color: 'w' | 'b' }) => void) | null = null;

  constructor(private events: OnlineEvents) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('No se pudo conectar')), { once: true });
    });
    ws.addEventListener('message', (e) => this.handle(JSON.parse(e.data as string)));
    ws.addEventListener('close', () => {
      if (this.ws === ws) {
        this.ws = null;
        this.events.onClosed();
      }
    });
  }

  private handle(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'created':
        this.pendingCreate?.(msg as unknown as { code: string; color: 'w' | 'b' });
        this.pendingCreate = null;
        break;
      case 'start':
        this.events.onStart(msg as unknown as StartInfo);
        break;
      case 'move':
        this.events.onMove(msg as unknown as { san: string; from: string; to: string; promotion?: string });
        break;
      case 'game-over':
        this.events.onGameOver(msg as unknown as { result: string; reason: string; by?: 'w' | 'b' });
        break;
      case 'opponent-status':
        this.events.onOpponentStatus(Boolean(msg.online));
        break;
      case 'error':
        this.events.onError(String(msg.code ?? 'desconocido'));
        break;
    }
  }

  private send(payload: unknown): void {
    this.ws?.send(JSON.stringify(payload));
  }

  async create(color: 'w' | 'b' | 'random'): Promise<{ code: string; color: 'w' | 'b' }> {
    await this.connect();
    return new Promise((resolve) => {
      this.pendingCreate = resolve;
      this.send({ type: 'create', color });
    });
  }

  /** Une (o reconecta) a una partida; el resultado llega como evento onStart. */
  async join(code: string): Promise<void> {
    await this.connect();
    this.send({ type: 'join', code });
  }

  sendMove(from: string, to: string, promotion?: string): void {
    this.send({ type: 'move', from, to, promotion });
  }

  resign(): void {
    this.send({ type: 'resign' });
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
