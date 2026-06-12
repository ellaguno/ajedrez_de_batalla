/**
 * Efectos de sonido procedurales (Web Audio API): sin archivos de audio.
 * El AudioContext se crea perezosamente en el primer gesto del usuario.
 */

class AudioFx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Llamar en el primer gesto del usuario para desbloquear el audio. */
  unlock(): void {
    this.ensure();
  }

  private tone(
    freq: number,
    {
      type = 'sine' as OscillatorType,
      at = 0,
      dur = 0.15,
      vol = 0.3,
      slide = 0,
    } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise({
    at = 0,
    dur = 0.12,
    vol = 0.25,
    freq = 1200,
    q = 1,
    type = 'bandpass' as BiquadFilterType,
  } = {}): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  /** Deslizamiento de pieza por el tablero. */
  slide(): void {
    this.noise({ dur: 0.22, vol: 0.08, freq: 900, q: 0.7, type: 'lowpass' });
  }

  /** Pieza colocada en la casilla (toc de madera). */
  knock(): void {
    this.tone(170, { type: 'sine', dur: 0.09, vol: 0.35, slide: -60 });
    this.noise({ dur: 0.03, vol: 0.12, freq: 2200 });
  }

  /** Choque de armas en el combate. */
  clash(): void {
    this.noise({ dur: 0.18, vol: 0.3, freq: 3400, q: 2.5 });
    this.tone(2480, { type: 'triangle', dur: 0.22, vol: 0.12 });
    this.tone(3690, { type: 'triangle', dur: 0.16, vol: 0.08 });
    this.tone(95, { type: 'sine', dur: 0.12, vol: 0.25, slide: -30 });
  }

  /** La víctima cae. */
  fall(): void {
    this.tone(82, { type: 'sine', dur: 0.25, vol: 0.35, slide: -40 });
    this.noise({ dur: 0.2, vol: 0.12, freq: 350, type: 'lowpass' });
  }

  /** Aviso de jaque. */
  check(): void {
    this.tone(660, { type: 'square', dur: 0.1, vol: 0.1 });
    this.tone(990, { type: 'square', at: 0.11, dur: 0.16, vol: 0.1 });
  }

  /** Inicio de partida. */
  start(): void {
    for (const [i, f] of [392, 494, 587].entries()) {
      this.tone(f, { type: 'triangle', at: i * 0.09, dur: 0.16, vol: 0.16 });
    }
  }

  /** Final de partida. */
  gameOver(victory: boolean): void {
    const notes = victory ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    for (const [i, f] of notes.entries()) {
      this.tone(f, { type: 'triangle', at: i * 0.14, dur: 0.3, vol: 0.16 });
    }
  }
}

export const sfx = new AudioFx();
