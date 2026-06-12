import type { Move } from 'chess.js';
import type { GameConfig, PlayerConfig } from '../types';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

export interface HudActions {
  onNewGame(): void;
  onUndo(): void;
  onFlip(): void;
  onToggleTheme(): void;
  onSetChange(id: string): void;
  onSkip(): void;
  onCinematicsToggle(enabled: boolean): void;
  onSoundToggle(enabled: boolean): void;
  onBackdropChange(value: string): void;
}

export class Hud {
  private status = $<HTMLDivElement>('status');
  private players = $<HTMLDivElement>('players');
  private moves = $<HTMLOListElement>('moves');
  private banner = $<HTMLDivElement>('banner');
  private dlgNew = $<HTMLDialogElement>('dlg-new');
  private dlgPromote = $<HTMLDialogElement>('dlg-promote');
  private setSelect = $<HTMLSelectElement>('set-select');
  private btnSkip = $<HTMLButtonElement>('btn-skip');
  private chkCine = $<HTMLInputElement>('chk-cine');
  private chkSound = $<HTMLInputElement>('chk-sound');
  private backdropSelect = $<HTMLSelectElement>('backdrop-select');

  constructor(actions: HudActions) {
    $('btn-new').addEventListener('click', actions.onNewGame);
    $('btn-undo').addEventListener('click', actions.onUndo);
    $('btn-flip').addEventListener('click', actions.onFlip);
    $('btn-theme').addEventListener('click', actions.onToggleTheme);
    this.setSelect.addEventListener('change', () => actions.onSetChange(this.setSelect.value));
    this.btnSkip.addEventListener('click', actions.onSkip);
    this.chkCine.addEventListener('change', () => actions.onCinematicsToggle(this.chkCine.checked));
    this.chkSound.addEventListener('change', () => actions.onSoundToggle(this.chkSound.checked));
    this.backdropSelect.addEventListener('change', () =>
      actions.onBackdropChange(this.backdropSelect.value),
    );

    // El selector de nivel solo aplica a Stockfish.
    for (const [kindId, skillId] of [
      ['cfg-white', 'cfg-white-skill'],
      ['cfg-black', 'cfg-black-skill'],
    ]) {
      const kind = $<HTMLSelectElement>(kindId);
      kind.addEventListener('change', () => {
        $<HTMLSelectElement>(skillId).style.visibility =
          kind.value === 'engine' ? 'visible' : 'hidden';
      });
    }
  }

  setCinematicActive(active: boolean): void {
    this.btnSkip.hidden = !active;
  }

  setCinematicsEnabled(enabled: boolean): void {
    this.chkCine.checked = enabled;
  }

  setSoundEnabled(enabled: boolean): void {
    this.chkSound.checked = enabled;
  }

  /** Rellena el selector de fondos con los HDRI disponibles. */
  populateBackdrops(hdris: { name: string; url: string }[], active: string): void {
    for (const old of this.backdropSelect.querySelectorAll('option[data-hdri]')) old.remove();
    for (const h of hdris) {
      const opt = document.createElement('option');
      opt.value = h.url;
      opt.textContent = h.name;
      opt.dataset.hdri = '1';
      this.backdropSelect.append(opt);
    }
    this.backdropSelect.value = [...this.backdropSelect.options].some((o) => o.value === active)
      ? active
      : 'sala';
  }

  /** Añade los modelos LLM disponibles a los selectores de jugador. */
  populateLlmModels(models: { id: number; name: string }[]): void {
    for (const selectId of ['cfg-white', 'cfg-black']) {
      const select = $<HTMLSelectElement>(selectId);
      for (const old of select.querySelectorAll('option[data-llm]')) old.remove();
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = `llm:${m.id}`;
        opt.textContent = `IA: ${m.name}`;
        opt.dataset.llm = '1';
        select.append(opt);
      }
    }
  }

  populateSets(sets: { id: string; name: string }[], activeId: string): void {
    this.setSelect.replaceChildren(
      ...sets.map((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        return opt;
      }),
    );
    this.setSelect.value = activeId;
  }

  /** Refleja el set realmente activo (p. ej. tras un fallback). */
  markActiveSet(id: string): void {
    this.setSelect.value = id;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setPlayers(config: GameConfig): void {
    const desc = (p: PlayerConfig) => {
      if (p.kind === 'human') return p.label ?? 'Humano';
      if (p.kind === 'llm') return p.label ?? 'IA (LLM)';
      if (p.kind === 'remote') return p.label ?? 'Rival en línea';
      return `Stockfish nivel ${p.skill ?? 5}`;
    };
    this.players.textContent = `Blancas: ${desc(config.white)}\nNegras: ${desc(config.black)}`;
  }

  setMoves(history: Move[]): void {
    this.moves.replaceChildren();
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li');
      const white = document.createElement('span');
      white.textContent = history[i].san;
      li.append(white);
      if (history[i + 1]) {
        const black = document.createElement('span');
        black.textContent = history[i + 1].san;
        li.append(black);
      }
      this.moves.append(li);
    }
    this.moves.scrollTop = this.moves.scrollHeight;
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.hidden = false;
  }

  hideBanner(): void {
    this.banner.hidden = true;
  }

  /** Diálogo de nueva partida; null si se cancela. */
  askNewGame(): Promise<GameConfig | null> {
    return new Promise((resolve) => {
      const onClose = () => {
        this.dlgNew.removeEventListener('close', onClose);
        if (this.dlgNew.returnValue !== 'ok') {
          resolve(null);
          return;
        }
        const read = (kindId: string, skillId: string): PlayerConfig => {
          const select = $<HTMLSelectElement>(kindId);
          const value = select.value;
          if (value === 'engine') {
            return { kind: 'engine', skill: Number($<HTMLSelectElement>(skillId).value) };
          }
          if (value.startsWith('llm:')) {
            return {
              kind: 'llm',
              modelId: Number(value.slice(4)),
              label: select.selectedOptions[0]?.textContent?.replace(/^IA: /, '') ?? 'LLM',
            };
          }
          return { kind: 'human' };
        };
        resolve({
          white: read('cfg-white', 'cfg-white-skill'),
          black: read('cfg-black', 'cfg-black-skill'),
        });
      };
      this.dlgNew.addEventListener('close', onClose);
      this.dlgNew.showModal();
    });
  }

  /** Selector de pieza de promoción; nunca se cancela (Escape = dama). */
  askPromotion(): Promise<string> {
    return new Promise((resolve) => {
      const buttons = this.dlgPromote.querySelectorAll<HTMLButtonElement>('button[data-piece]');
      const done = (piece: string) => {
        for (const b of buttons) b.onclick = null;
        this.dlgPromote.removeEventListener('close', onClose);
        if (this.dlgPromote.open) this.dlgPromote.close();
        resolve(piece);
      };
      const onClose = () => done('q');
      for (const b of buttons) {
        b.onclick = () => done(b.dataset.piece!);
      }
      this.dlgPromote.addEventListener('close', onClose);
      this.dlgPromote.showModal();
    });
  }
}
