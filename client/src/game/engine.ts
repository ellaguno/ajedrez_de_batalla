/**
 * Envoltorio del motor Stockfish (WASM) corriendo en un Web Worker.
 * El build single-thread se sirve estático desde /engine/ (ver
 * scripts/copy-engine.mjs); se habla con él por el protocolo UCI.
 */

export interface EngineMove {
  from: string;
  to: string;
  promotion?: string;
}

type LineListener = (line: string) => boolean;

let manifestPromise: Promise<string> | null = null;

async function engineUrl(): Promise<string> {
  manifestPromise ??= fetch('/engine/manifest.json')
    .then((r) => {
      if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
      return r.json();
    })
    .then((m: { js: string }) => `/engine/${m.js}`);
  return manifestPromise;
}

export class EnginePlayer {
  private worker: Worker | null = null;
  private listeners = new Set<LineListener>();
  private ready: Promise<void> | null = null;
  private disposed = false;

  init(): Promise<void> {
    this.ready ??= this.start();
    return this.ready;
  }

  private async start(): Promise<void> {
    const url = await engineUrl();
    if (this.disposed) return;
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) {
        if (fn(line)) this.listeners.delete(fn);
      }
    };
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  private waitFor(pred: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      this.listeners.add((line) => {
        if (pred(line)) {
          resolve(line);
          return true;
        }
        return false;
      });
    });
  }

  setSkill(level: number): void {
    const skill = Math.max(0, Math.min(20, Math.round(level)));
    this.send(`setoption name Skill Level value ${skill}`);
  }

  async bestMove(fen: string, movetimeMs = 600): Promise<EngineMove> {
    await this.init();
    this.send(`position fen ${fen}`);
    this.send(`go movetime ${movetimeMs}`);
    const line = await this.waitFor((l) => l.startsWith('bestmove'));
    const uci = line.split(/\s+/)[1];
    if (!uci || uci === '(none)') throw new Error(`Stockfish sin jugada: "${line}"`);
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}
