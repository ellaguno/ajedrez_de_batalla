import { library, type LibraryCategory, type LibrarySummary } from '../api';

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const RESULT_LABEL: Record<string, string> = {
  '1-0': '1–0',
  '0-1': '0–1',
  '1/2-1/2': '½–½',
  '*': '*',
};

const CATEGORY_LABEL: Record<LibraryCategory, string> = {
  famous: 'Famosas',
  educational: 'Educativas',
  endgame: 'Finales',
  opening: 'Aperturas y trampas',
};

const TABS: { key: LibraryCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'famous', label: 'Famosas' },
  { key: 'educational', label: 'Educativas' },
  { key: 'endgame', label: 'Finales' },
  { key: 'opening', label: 'Aperturas y trampas' },
];

const PAGE = 60;

export interface LibraryActions {
  /** Reproduce la partida elegida (nombre + PGN bastan para el reproductor). */
  onReplay(game: { name: string; pgn: string }): void;
}

/** Diálogo "Biblioteca": partidas famosas, educativas, finales y trampas. */
export class LibraryUI {
  private dlg = $<HTMLDialogElement>('dlg-library');
  private tabsEl = $<HTMLDivElement>('library-tabs');
  private searchEl = $<HTMLInputElement>('library-search');
  private list = $<HTMLUListElement>('library-list');
  private moreBtn = $<HTMLButtonElement>('library-more');

  private filter: LibraryCategory | 'all' = 'all';
  private query = '';
  private offset = 0;
  private total = 0;
  private loading = false;
  private searchTimer = 0;

  constructor(private actions: LibraryActions) {
    $('btn-library').addEventListener('click', () => void this.open());
    $('library-close').addEventListener('click', () => this.dlg.close());
    this.moreBtn.addEventListener('click', () => void this.loadMore());
    this.searchEl.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.query = this.searchEl.value.trim();
        void this.reload();
      }, 250);
    });
    this.buildTabs();
  }

  private buildTabs(): void {
    this.tabsEl.replaceChildren(
      ...TABS.map((t) => {
        const b = document.createElement('button');
        b.className = 'library-tab';
        b.dataset.key = t.key;
        b.textContent = t.label;
        b.setAttribute('aria-pressed', String(t.key === this.filter));
        b.addEventListener('click', () => {
          this.filter = t.key;
          for (const el of this.tabsEl.querySelectorAll('.library-tab')) {
            el.setAttribute('aria-pressed', String((el as HTMLElement).dataset.key === t.key));
          }
          void this.reload();
        });
        return b;
      }),
    );
  }

  async open(): Promise<void> {
    this.dlg.showModal();
    void this.refreshCounts();
    await this.reload();
  }

  private async refreshCounts(): Promise<void> {
    try {
      const { counts, total } = await library.categories();
      for (const el of this.tabsEl.querySelectorAll<HTMLElement>('.library-tab')) {
        const key = el.dataset.key as LibraryCategory | 'all';
        const n = key === 'all' ? total : counts[key] ?? 0;
        const base = TABS.find((t) => t.key === key)?.label ?? key;
        el.textContent = `${base} (${n})`;
      }
    } catch {
      /* sin conteos, las pestañas quedan sin número */
    }
  }

  private async reload(): Promise<void> {
    this.offset = 0;
    this.total = 0;
    this.list.replaceChildren();
    this.renderEmpty('Cargando…');
    await this.loadMore(true);
  }

  private renderEmpty(text: string): void {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    this.list.replaceChildren(li);
  }

  private async loadMore(replace = false): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.moreBtn.disabled = true;
    try {
      const page = await library.list({
        category: this.filter === 'all' ? undefined : this.filter,
        q: this.query || undefined,
        limit: PAGE,
        offset: this.offset,
      });
      this.total = page.total;
      if (replace) this.list.replaceChildren();
      if (page.total === 0) {
        this.renderEmpty(this.query ? 'Sin resultados para tu búsqueda.' : 'No hay partidas en esta categoría.');
        return;
      }
      this.list.append(...page.items.map((g) => this.row(g)));
      this.offset += page.items.length;
    } catch {
      if (replace) this.renderEmpty('No se pudo cargar la biblioteca.');
    } finally {
      this.loading = false;
      const remaining = this.total - this.offset;
      this.moreBtn.hidden = remaining <= 0;
      this.moreBtn.disabled = false;
      this.moreBtn.textContent = remaining > 0 ? `Cargar más (${remaining})` : 'Cargar más';
    }
  }

  private row(g: LibrarySummary): HTMLLIElement {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'game-info';

    const name = document.createElement('div');
    name.className = 'game-name';
    const tag = document.createElement('span');
    tag.className = 'library-cat';
    tag.textContent = CATEGORY_LABEL[g.category];
    name.append(tag, document.createTextNode(' ' + g.name));

    const meta = document.createElement('div');
    meta.className = 'game-meta';
    const bits: string[] = [];
    if (g.white && g.black && !g.name.includes('–')) bits.push(`${g.white} – ${g.black}`);
    if (g.event) bits.push(g.event);
    if (g.date) bits.push(g.date);
    bits.push(`${g.moves} jugadas`);
    bits.push(RESULT_LABEL[g.result] ?? g.result);
    if (g.eco) bits.push(g.eco);
    meta.textContent = bits.join(' · ');
    info.append(name, meta);

    if (g.description) {
      const desc = document.createElement('div');
      desc.className = 'library-desc';
      desc.textContent = g.description;
      info.append(desc);
    }

    const play = document.createElement('button');
    play.className = 'primary';
    play.textContent = 'Reproducir';
    play.addEventListener('click', () => void this.play(g.id));

    li.append(info, play);
    return li;
  }

  private async play(id: number): Promise<void> {
    try {
      const full = await library.get(id);
      this.dlg.close();
      this.actions.onReplay({ name: full.name, pgn: full.pgn });
    } catch {
      this.renderEmpty('No se pudo abrir la partida.');
    }
  }
}
