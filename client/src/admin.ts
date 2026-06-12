import './style.css';
import * as api from './api';
import { loadTheme } from './storage';

/** Página de administración: modelos LLM (con claves) y sets de piezas. */

document.documentElement.dataset.theme = loadTheme();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const msg = $<HTMLDivElement>('admin-msg');
function show(text: string, isError = false): void {
  msg.textContent = text;
  msg.classList.toggle('error', isError);
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 5000);
}

function describe(err: unknown): string {
  return err instanceof api.ApiError ? err.code : 'error inesperado';
}

// ----------------------------------------------------------- modelos LLM
let editingId: number | null = null;

async function refreshLlm(): Promise<void> {
  const rows = await api.admin.llmList();
  const tbody = $<HTMLTableElement>('llm-table').querySelector('tbody')!;
  tbody.replaceChildren(
    ...rows.map((m) => {
      const tr = document.createElement('tr');
      const td = (text: string) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        return cell;
      };
      tr.append(
        td(m.name),
        td(m.provider),
        td(m.model),
        td(m.baseUrl ?? '—'),
        td(m.hasKey ? '●●●' : '—'),
        td(m.enabled ? 'Sí' : 'No'),
      );
      const actions = document.createElement('td');
      const btn = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      };
      actions.append(
        btn('Editar', () => {
          editingId = m.id;
          $<HTMLInputElement>('llm-name').value = m.name;
          $<HTMLSelectElement>('llm-provider').value = m.provider;
          $<HTMLInputElement>('llm-model').value = m.model;
          $<HTMLInputElement>('llm-base').value = m.baseUrl ?? '';
          $<HTMLInputElement>('llm-key').value = '';
          $<HTMLInputElement>('llm-enabled').checked = m.enabled;
          $('llm-form-title').textContent = `Editando: ${m.name}`;
          $('llm-cancel').hidden = false;
        }),
        btn(m.enabled ? 'Desactivar' : 'Activar', () => {
          void api.admin
            .llmUpdate(m.id, {
              name: m.name,
              provider: m.provider,
              baseUrl: m.baseUrl ?? undefined,
              model: m.model,
              enabled: !m.enabled,
            })
            .then(refreshLlm)
            .catch((e) => show(`No se pudo actualizar (${describe(e)})`, true));
        }),
        btn('Borrar', () => {
          if (!window.confirm(`¿Borrar el modelo "${m.name}"?`)) return;
          void api.admin.llmRemove(m.id).then(refreshLlm);
        }),
      );
      tr.append(actions);
      return tr;
    }),
  );
}

function resetForm(): void {
  editingId = null;
  ($('llm-form') as HTMLFormElement).reset();
  $<HTMLInputElement>('llm-enabled').checked = true;
  $('llm-form-title').textContent = 'Añadir modelo';
  $('llm-cancel').hidden = true;
}

$('llm-cancel').addEventListener('click', resetForm);
$('llm-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const payload: api.AdminLlmPayload = {
    name: $<HTMLInputElement>('llm-name').value.trim(),
    provider: $<HTMLSelectElement>('llm-provider').value as 'openai' | 'anthropic',
    model: $<HTMLInputElement>('llm-model').value.trim(),
    baseUrl: $<HTMLInputElement>('llm-base').value.trim() || undefined,
    apiKey: $<HTMLInputElement>('llm-key').value || undefined,
    enabled: $<HTMLInputElement>('llm-enabled').checked,
  };
  const action =
    editingId !== null ? api.admin.llmUpdate(editingId, payload) : api.admin.llmCreate(payload);
  void action
    .then(() => {
      show('Modelo guardado.');
      resetForm();
      return refreshLlm();
    })
    .catch((e) => show(`No se pudo guardar (${describe(e)})`, true));
});

// ------------------------------------------------------------------- sets
async function refreshSets(): Promise<void> {
  const sets = await api.admin.setsList();
  const list = $<HTMLUListElement>('sets-list');
  if (sets.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aún no hay sets subidos.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...sets.map((s) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${s.name} (${s.id})`;
      const del = document.createElement('button');
      del.textContent = 'Borrar';
      del.addEventListener('click', () => {
        if (!window.confirm(`¿Borrar el set "${s.name}"?`)) return;
        void api.admin.setRemove(s.id).then(refreshSets);
      });
      li.append(span, del);
      return li;
    }),
  );
}

$('set-upload').addEventListener('click', () => {
  const input = $<HTMLInputElement>('set-file');
  const file = input.files?.[0];
  if (!file) return show('Elige un archivo ZIP primero.', true);
  void api.admin
    .setUpload(file)
    .then((r) => {
      show(`Set "${r.id}" subido.`);
      input.value = '';
      return refreshSets();
    })
    .catch((e) => show(`No se pudo subir (${describe(e)})`, true));
});

// --------------------------------------------------------------- arranque
void (async () => {
  try {
    const me = await api.auth.me();
    if (!me.user?.admin) throw new Error('no-admin');
    $('admin-main').hidden = false;
    await Promise.all([refreshLlm(), refreshSets()]);
  } catch {
    $('admin-denied').hidden = false;
  }
})();
