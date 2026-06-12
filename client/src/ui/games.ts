import { games, type GameFull, type GameSummary } from '../api';

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const RESULT_LABEL: Record<string, string> = {
  '1-0': 'Ganaron blancas',
  '0-1': 'Ganaron negras',
  '1/2-1/2': 'Tablas',
  '*': 'En curso',
};

export interface GamesActions {
  onResume(game: GameFull): void;
  onReplay(game: GameFull): void;
}

/** Diálogo "Mis partidas": lista del servidor con continuar/repetir/borrar. */
export class GamesUI {
  private dlg = $<HTMLDialogElement>('dlg-games');
  private list = $<HTMLUListElement>('games-list');

  constructor(private actions: GamesActions) {
    $('btn-games').addEventListener('click', () => void this.open());
    $('games-close').addEventListener('click', () => this.dlg.close());
  }

  async open(): Promise<void> {
    this.dlg.showModal();
    this.renderEmpty('Cargando…');
    try {
      this.render(await games.list());
    } catch {
      this.renderEmpty('No se pudieron cargar las partidas.');
    }
  }

  private renderEmpty(text: string): void {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    this.list.replaceChildren(li);
  }

  private render(items: GameSummary[]): void {
    if (items.length === 0) {
      this.renderEmpty('Aún no tienes partidas guardadas. Juega una con la sesión iniciada.');
      return;
    }
    this.list.replaceChildren(
      ...items.map((g) => {
        const li = document.createElement('li');

        const info = document.createElement('div');
        info.className = 'game-info';
        const name = document.createElement('div');
        name.className = 'game-name';
        name.textContent = g.name;
        const meta = document.createElement('div');
        meta.className = 'game-meta';
        const fecha = new Date(g.updatedAt + 'Z').toLocaleString();
        meta.textContent = `${g.moves} jugadas · ${RESULT_LABEL[g.result] ?? g.result} · ${fecha}`;
        info.append(name, meta);

        const mkBtn = (label: string, fn: () => void) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', fn);
          return b;
        };
        li.append(
          info,
          mkBtn('Continuar', () => void this.act(g.id, this.actions.onResume)),
          mkBtn('Repetir', () => void this.act(g.id, this.actions.onReplay)),
          mkBtn('Borrar', () => void this.remove(g.id, li)),
        );
        return li;
      }),
    );
  }

  private async act(id: number, fn: (game: GameFull) => void): Promise<void> {
    try {
      const full = await games.get(id);
      this.dlg.close();
      fn(full);
    } catch {
      this.renderEmpty('No se pudo abrir la partida.');
    }
  }

  private async remove(id: number, li: HTMLLIElement): Promise<void> {
    try {
      await games.remove(id);
      li.remove();
      if (this.list.children.length === 0) this.renderEmpty('Sin partidas guardadas.');
    } catch {
      /* se deja la fila si falla */
    }
  }
}
