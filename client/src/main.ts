import './style.css';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { GameController } from './game/GameController';
import { piecesOf } from './game/util';
import { SceneManager } from './scene/SceneManager';
import type { HighlightKind } from './scene/board';
import { Hud } from './ui/hud';
import { AuthUI } from './ui/auth';
import { GamesUI } from './ui/games';
import * as storage from './storage';
import * as api from './api';
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
  return player.kind === 'engine'
    ? `Turno: ${color} (IA pensando…)${check}`
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
  return p.kind === 'human' ? 'Humano' : `Stockfish ${p.skill ?? 5}`;
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
    persistLocal();
    scheduleServerSave();
  },
  onGameOver(info: GameOverInfo) {
    if (replay) return;
    hud.showBanner(gameOverText(info));
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
applyTheme(storage.loadTheme());
scene.cinematicsEnabled = storage.loadCinematics();
hud.setCinematicsEnabled(scene.cinematicsEnabled);

/** El tablero no acepta interacción hasta que termina el arranque. */
let appReady = false;

async function start(): Promise<void> {
  await authUi.init();
  availableSets = await listSets();
  hud.populateSets(availableSets, activeSetId);
  await applySetById(activeSetId);

  const saved = storage.loadGame();
  const defaultConfig: GameConfig = {
    white: { kind: 'human' },
    black: { kind: 'engine', skill: 5 },
  };
  const config = saved?.config ?? defaultConfig;
  serverGameId = saved?.serverGameId ?? null;
  currentGameName = saved?.name ?? makeGameName(config);
  await controller.newGame(config, saved?.pgn || undefined);
  appReady = true;
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
