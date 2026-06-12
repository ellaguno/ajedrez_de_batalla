import './style.css';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { GameController } from './game/GameController';
import { piecesOf } from './game/util';
import { sfx } from './scene/audio';
import { SceneManager } from './scene/SceneManager';
import type { HighlightKind } from './scene/board';
import { Hud } from './ui/hud';
import { AuthUI } from './ui/auth';
import { GamesUI } from './ui/games';
import * as storage from './storage';
import * as api from './api';
import { OnlineClient, onlineErrorText, type StartInfo } from './online';
import { listSets, loadSet } from './sets/SetLoader';
import type { PieceSetInfo } from './sets/types';
import type { AppliedMove, GameConfig, GameOverInfo, PlayerConfig } from './types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const scene = new SceneManager(canvas);

let selected: Square | null = null;
let lastMove: { from: string; to: string } | null = null;
let currentUser: api.User | null = null;
let serverGameId: number | null = null;
let currentGameName = '';

// ------------------------------------------------------------------ replay
interface ReplayState {
  chess: Chess;
  moves: Move[];
  index: number;
  busy: boolean;
  name: string;
}
let replay: ReplayState | null = null;

// -------------------------------------------------------------- resaltados
function kingSquare(color: 'w' | 'b'): string | null {
  return controller.pieces().find((p) => p.type === 'k' && p.color === color)?.square ?? null;
}

function refreshHighlights(): void {
  const map = new Map<string, HighlightKind>();
  if (lastMove) {
    map.set(lastMove.from, 'last');
    map.set(lastMove.to, 'last');
  }
  if (controller.chess.isCheck()) {
    const k = kingSquare(controller.turn);
    if (k) map.set(k, 'check');
  }
  if (selected) {
    for (const m of controller.legalTargets(selected)) {
      map.set(m.to, m.captured ? 'capture' : 'move');
    }
    map.set(selected, 'selected');
  }
  scene.setHighlights(map);
}

/** Sincroniza el tablero con la fuente activa (repetición o partida). */
function syncBoard(): void {
  if (replay) {
    scene.syncPieces(piecesOf(replay.chess));
    const prev = replay.chess.history({ verbose: true }).at(-1);
    scene.setHighlights(
      prev ? new Map([[prev.from, 'last'], [prev.to, 'last']] as [string, HighlightKind][]) : new Map(),
    );
  } else {
    scene.syncPieces(controller.pieces());
    refreshHighlights();
  }
}

// ------------------------------------------------------------------ estado
function statusText(): string {
  const over = controller.gameOverInfo();
  if (over) return gameOverText(over);
  const color = controller.turn === 'w' ? 'blancas' : 'negras';
  const player = controller.playerFor(controller.turn);
  const check = controller.chess.isCheck() ? ' — ¡jaque!' : '';
  if (player.kind === 'remote') return `Turno: ${color} — esperando a ${playerDesc(player)}${check}`;
  return player.kind !== 'human'
    ? `Turno: ${color} (${playerDesc(player)} pensando…)${check}`
    : `Turno: ${color}${check}`;
}

function gameOverText(info: GameOverInfo): string {
  switch (info.reason) {
    case 'checkmate':
      return `¡Jaque mate! Ganan las ${info.winner === 'w' ? 'blancas' : 'negras'}`;
    case 'stalemate':
      return 'Tablas por ahogado';
    case 'threefold':
      return 'Tablas por triple repetición';
    case 'insufficient':
      return 'Tablas por material insuficiente';
    case 'fifty-moves':
      return 'Tablas por la regla de 50 jugadas';
    default:
      return 'Tablas';
  }
}

function playerDesc(p: PlayerConfig): string {
  if (p.kind === 'human') return p.label ?? 'Humano';
  if (p.kind === 'llm') return p.label ?? 'IA LLM';
  if (p.kind === 'remote') return p.label ?? 'Rival en línea';
  return `Stockfish ${p.skill ?? 5}`;
}

function makeGameName(config: GameConfig): string {
  const fecha = new Date().toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${playerDesc(config.white)} vs ${playerDesc(config.black)} — ${fecha}`;
}

function resultStr(): string {
  const over = controller.gameOverInfo();
  if (!over) return '*';
  if (over.reason === 'checkmate') return over.winner === 'w' ? '1-0' : '0-1';
  return '1/2-1/2';
}

// ------------------------------------------------------ guardado (local+srv)
function persistLocal(): void {
  storage.saveGame({
    ...controller.serialize(),
    name: currentGameName,
    serverGameId,
  });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleServerSave(): void {
  if (!currentUser || replay) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void serverSave(), 800);
}

async function serverSave(): Promise<void> {
  if (!currentUser) return;
  const moves = controller.chess.history().length;
  if (moves === 0) return;
  const payload: api.GamePayload = {
    name: currentGameName,
    pgn: controller.chess.pgn(),
    config: controller.config,
    result: resultStr(),
    moves,
  };
  try {
    if (serverGameId) {
      await api.games.update(serverGameId, payload);
    } else {
      serverGameId = (await api.games.create(payload)).id;
      persistLocal();
    }
  } catch (err) {
    console.warn('No se pudo guardar la partida en el servidor', err);
  }
}

// -------------------------------------------------------------- controlador
const controller = new GameController({
  async onMoveApplied(applied: AppliedMove) {
    if (replay) return;
    selected = null;
    lastMove = { from: applied.move.from, to: applied.move.to };
    refreshHighlights();
    await scene.animateMove(applied);
    if (replay) return;
    scene.syncPieces(controller.pieces());
    refreshHighlights();
  },
  onPositionReset() {
    selected = null;
    lastMove = null;
    if (!replay) syncBoard();
  },
  onStateChanged() {
    if (replay) return;
    hud.setStatus(statusText());
    hud.setMoves(controller.chess.history({ verbose: true }));
    hud.setPlayers(controller.config);
    if (controller.chess.isCheck() && !controller.chess.isGameOver()) sfx.check();
    persistLocal();
    scheduleServerSave();
  },
  onGameOver(info: GameOverInfo) {
    if (replay) return;
    hud.showBanner(gameOverText(info));
    sfx.gameOver(info.reason === 'checkmate');
  },
  onAutoPlayerError(message: string) {
    if (replay) return;
    hud.showBanner(message);
    hud.setStatus('Partida en pausa');
  },
});

// --------------------------------------------------------------------- sets
let availableSets: PieceSetInfo[] = [];
let activeSetId = storage.loadSetId();

async function applySetById(id: string): Promise<void> {
  const info = availableSets.find((s) => s.id === id) ?? availableSets[0];
  let set;
  try {
    set = await loadSet(info);
  } catch (err) {
    console.error(`No se pudo cargar el set "${id}"; se usa el clásico`, err);
    set = await loadSet({ id: 'clasico', name: 'Clásico', builtin: true });
  }
  activeSetId = set.id;
  scene.applySet(set);
  syncBoard();
  hud.markActiveSet(activeSetId);
  storage.saveSetId(activeSetId);
}

// ---------------------------------------------------------------------- HUD
const hud = new Hud({
  async onNewGame() {
    const config = await hud.askNewGame();
    if (!config) return;
    exitReplay();
    endOnline();
    hud.hideBanner();
    storage.clearGame();
    serverGameId = null;
    currentGameName = makeGameName(config);
    await controller.newGame(config);
  },
  onUndo() {
    if (replay) return;
    hud.hideBanner();
    controller.undo();
  },
  onFlip() {
    viewIsWhite = !viewIsWhite;
    void scene.flipView();
  },
  onToggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    storage.saveTheme(next);
  },
  onSetChange(id: string) {
    void applySetById(id);
  },
  onSkip() {
    scene.requestSkip();
  },
  onCinematicsToggle(enabled: boolean) {
    scene.cinematicsEnabled = enabled;
    storage.saveCinematics(enabled);
  },
  onSoundToggle(enabled: boolean) {
    sfx.enabled = enabled;
    if (enabled) sfx.knock();
    storage.saveSound(enabled);
  },
  onBackdropChange(value: string) {
    storage.saveBackdrop(value);
    scene.setBackdrop(value).catch((err) => {
      console.error('No se pudo cargar el fondo', err);
      hud.showBanner('No se pudo cargar ese fondo.');
      void scene.setBackdrop('sala');
    });
  },
});

scene.onCinematicChange = (active) => hud.setCinematicActive(active);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') scene.requestSkip();
});

function applyTheme(theme: storage.Theme): void {
  document.documentElement.dataset.theme = theme;
  scene.setTheme(theme);
}

// ------------------------------------------------------------------- replay
const rpBar = document.getElementById('replay-bar') as HTMLDivElement;
const rpPos = document.getElementById('rp-pos') as HTMLSpanElement;

function enterReplay(game: api.GameFull): void {
  const full = new Chess();
  try {
    full.loadPgn(game.pgn);
  } catch (err) {
    console.error('PGN inválido para repetición', err);
    return;
  }
  controller.halt();
  hud.hideBanner();
  replay = { chess: new Chess(), moves: full.history({ verbose: true }), index: 0, busy: false, name: game.name };
  rpBar.hidden = false;
  syncBoard();
  updateReplayUi();
}

function exitReplay(): void {
  if (!replay) return;
  replay = null;
  rpBar.hidden = true;
  syncBoard();
  hud.setStatus(statusText());
  hud.setMoves(controller.chess.history({ verbose: true }));
}

function updateReplayUi(): void {
  if (!replay) return;
  rpPos.textContent = `${replay.index} / ${replay.moves.length}`;
  hud.setStatus(`Repetición — ${replay.name}`);
  hud.setMoves(replay.chess.history({ verbose: true }));
}

async function replayNext(): Promise<void> {
  if (!replay || replay.busy) return;
  const move = replay.moves[replay.index];
  if (!move) return;
  replay.busy = true;
  replay.chess.move(move.san);
  replay.index++;
  updateReplayUi();
  await scene.animateMove({ move, check: false, gameOver: false });
  if (replay) {
    syncBoard();
    replay.busy = false;
  }
}

function replayPrev(): void {
  if (!replay || replay.busy || replay.index === 0) return;
  replay.chess.undo();
  replay.index--;
  syncBoard();
  updateReplayUi();
}

function replayStart(): void {
  if (!replay || replay.busy) return;
  replay.chess.reset();
  replay.index = 0;
  syncBoard();
  updateReplayUi();
}

function replayEnd(): void {
  if (!replay || replay.busy) return;
  while (replay.index < replay.moves.length) {
    replay.chess.move(replay.moves[replay.index].san);
    replay.index++;
  }
  syncBoard();
  updateReplayUi();
}

document.getElementById('rp-next')!.addEventListener('click', () => void replayNext());
document.getElementById('rp-prev')!.addEventListener('click', replayPrev);
document.getElementById('rp-start')!.addEventListener('click', replayStart);
document.getElementById('rp-end')!.addEventListener('click', replayEnd);
document.getElementById('rp-exit')!.addEventListener('click', exitReplay);

// ------------------------------------------------------------------- online
let online: { code: string; myColor: 'w' | 'b' } | null = null;
let viewIsWhite = true;
/** Serializa las jugadas del servidor para no solapar animaciones. */
let serverMoveChain = Promise.resolve();

const $id = (id: string) => document.getElementById(id)!;
const dlgOnline = $id('dlg-online') as HTMLDialogElement;
const onlineMsg = $id('online-msg') as HTMLDivElement;

function onlineError(text: string): void {
  if (dlgOnline.open) {
    onlineMsg.textContent = text;
    onlineMsg.hidden = false;
  } else {
    hud.showBanner(text);
  }
}

function endOnline(): void {
  online = null;
  controller.onlineSender = null;
  storage.saveOnlineCode(null);
  ($id('btn-resign') as HTMLButtonElement).hidden = true;
}

const onlineClient = new OnlineClient({
  onStart(info: StartInfo) {
    exitReplay();
    hud.hideBanner();
    online = { code: info.code, myColor: info.color };
    storage.saveOnlineCode(info.code);
    serverGameId = null;
    serverMoveChain = Promise.resolve();

    const seat = (c: 'w' | 'b'): PlayerConfig => ({
      kind: c === info.color ? 'human' : 'remote',
      label: c === 'w' ? info.white : info.black,
    });
    const config: GameConfig = { white: seat('w'), black: seat('b') };
    currentGameName = `${info.white} vs ${info.black} — en línea`;
    controller.onlineSender = (f, t, p) => onlineClient.sendMove(f, t, p);

    void controller.newGame(config, info.pgn || undefined).then(() => {
      if (info.status === 'finished') {
        endOnline();
      } else {
        ($id('btn-resign') as HTMLButtonElement).hidden = false;
      }
      // El tablero se mira desde el bando propio.
      if ((info.color === 'b') === viewIsWhite) {
        viewIsWhite = !viewIsWhite;
        void scene.flipView();
      }
    });
    if (dlgOnline.open) dlgOnline.close();
  },
  onMove(mv) {
    serverMoveChain = serverMoveChain.then(() =>
      controller.applyServerMove(mv.from as Square, mv.to as Square, mv.promotion),
    );
  },
  onGameOver(info) {
    serverMoveChain = serverMoveChain.then(() => {
      if (info.reason === 'resign') {
        controller.halt();
        hud.showBanner(
          info.by === 'w'
            ? 'Las blancas se rinden — ganan las negras'
            : 'Las negras se rinden — ganan las blancas',
        );
        hud.setStatus('Partida terminada');
      }
      endOnline();
    });
  },
  onOpponentStatus(connected) {
    hud.setStatus(connected ? statusText() : 'Tu rival se ha desconectado…');
  },
  onError(code) {
    if (code === 'partida-no-existe') storage.saveOnlineCode(null);
    onlineError(onlineErrorText(code));
  },
  onClosed() {
    if (online) hud.setStatus('Conexión perdida — recarga la página para reconectar');
  },
});

$id('btn-online').addEventListener('click', () => {
  onlineMsg.hidden = true;
  $id('online-code-box').hidden = true;
  dlgOnline.showModal();
});
$id('online-close').addEventListener('click', () => dlgOnline.close());
$id('online-create').addEventListener('click', () => {
  void (async () => {
    try {
      const color = ($id('online-color') as HTMLSelectElement).value as 'w' | 'b' | 'random';
      const created = await onlineClient.create(color);
      $id('online-code').textContent = created.code;
      $id('online-code-box').hidden = false;
      onlineMsg.hidden = true;
    } catch {
      onlineError('No se pudo conectar con el servidor.');
    }
  })();
});
$id('online-join').addEventListener('click', () => {
  void (async () => {
    const code = ($id('online-join-code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) return onlineError('Escribe el código de la partida.');
    try {
      await onlineClient.join(code);
    } catch {
      onlineError('No se pudo conectar con el servidor.');
    }
  })();
});
$id('btn-resign').addEventListener('click', () => {
  if (online && window.confirm('¿Seguro que quieres rendirte?')) onlineClient.resign();
});

// ----------------------------------------------------------- cuenta/partidas
const authUi = new AuthUI((user) => {
  currentUser = user;
  if (user) scheduleServerSave();
});

new GamesUI({
  onResume(game) {
    exitReplay();
    hud.hideBanner();
    serverGameId = game.id;
    currentGameName = game.name;
    void controller.newGame(game.config, game.pgn);
  },
  onReplay(game) {
    enterReplay(game);
  },
});

// ------------------------------------------------------------- interacción
// El audio del navegador se desbloquea con el primer gesto del usuario.
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const downX = event.clientX;
  const downY = event.clientY;
  const onUp = (up: PointerEvent) => {
    canvas.removeEventListener('pointerup', onUp);
    if (Math.hypot(up.clientX - downX, up.clientY - downY) > 6) return;
    void handleBoardClick(up);
  };
  canvas.addEventListener('pointerup', onUp);
});

async function handleBoardClick(event: PointerEvent): Promise<void> {
  if (!appReady || replay || controller.busy || !controller.isHumanTurn()) return;
  const square = scene.pickSquare(event) as Square | null;
  if (!square) {
    selected = null;
    refreshHighlights();
    return;
  }

  if (selected && square !== selected) {
    const isTarget = controller.legalTargets(selected).some((m) => m.to === square);
    if (isTarget) {
      let promotion: string | undefined;
      if (controller.needsPromotion(selected, square)) {
        promotion = await hud.askPromotion();
      }
      await controller.makeHumanMove(selected, square, promotion);
      return;
    }
  }

  const piece = controller.pieces().find((p) => p.square === square);
  selected = piece && piece.color === controller.turn ? square : null;
  refreshHighlights();
}

// ----------------------------------------------------------------- arranque
document.getElementById('app-version')!.textContent = `v${__APP_VERSION__}`;
applyTheme(storage.loadTheme());
scene.cinematicsEnabled = storage.loadCinematics();
hud.setCinematicsEnabled(scene.cinematicsEnabled);
sfx.enabled = storage.loadSound();
hud.setSoundEnabled(sfx.enabled);

/** El tablero no acepta interacción hasta que termina el arranque. */
let appReady = false;

async function start(): Promise<void> {
  await authUi.init();
  try {
    hud.populateLlmModels(await api.llm.models());
  } catch (err) {
    console.warn('No se pudieron cargar los modelos LLM', err);
  }
  availableSets = await listSets();
  hud.populateSets(availableSets, activeSetId);
  await applySetById(activeSetId);

  const backdrop = storage.loadBackdrop();
  hud.populateBackdrops(await api.listHdris(), backdrop);
  if (backdrop !== 'sala') {
    scene.setBackdrop(backdrop).catch(() => {
      storage.saveBackdrop('sala');
      hud.populateBackdrops([], 'sala');
    });
  }

  const saved = storage.loadGame();
  const defaultConfig: GameConfig = {
    white: { kind: 'human' },
    black: { kind: 'engine', skill: 5 },
  };
  // Una partida online guardada no se reanuda en local: se reconecta abajo.
  const wasOnline =
    saved && (saved.config.white.kind === 'remote' || saved.config.black.kind === 'remote');
  const config = !saved || wasOnline ? defaultConfig : saved.config;
  serverGameId = wasOnline ? null : (saved?.serverGameId ?? null);
  currentGameName = (!wasOnline && saved?.name) || makeGameName(config);
  await controller.newGame(config, wasOnline ? undefined : saved?.pgn || undefined);
  appReady = true;

  // Reconexión a la partida en línea activa, si la hay.
  const onlineCode = storage.loadOnlineCode();
  if (currentUser && onlineCode) {
    onlineClient.join(onlineCode).catch(() => storage.saveOnlineCode(null));
  } else if (onlineCode && !currentUser) {
    storage.saveOnlineCode(null);
  }
}
void start();

// Gancho de depuración/pruebas (smoke tests con navegador headless).
(window as unknown as Record<string, unknown>).__adb = {
  projectSquare: (s: string) => scene.projectSquare(s),
  fen: () => controller.chess.fen(),
  setId: () => activeSetId,
  cameraPos: () => scene.cameraPosition(),
  user: () => currentUser,
  serverGameId: () => serverGameId,
  replay: () => (replay ? { index: replay.index, total: replay.moves.length } : null),
  busy: () => controller.busy,
  humanTurn: () => controller.isHumanTurn(),
  ready: () => appReady,
};
