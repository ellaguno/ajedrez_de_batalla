// Prueba de humo: carga la app, espera a que la IA (negras por defecto no juega
// hasta que muevan blancas) — así que probamos: 1) escena carga sin errores,
// 2) el worker de Stockfish responde uciok/readyok, 3) una partida IA vs IA
// configurada por localStorage produce jugadas reales.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

// Partida IA vs IA para que juegue sola.
await page.addInitScript(() => {
  localStorage.setItem(
    'adb.partida.v1',
    JSON.stringify({
      pgn: '',
      config: { white: { kind: 'engine', skill: 1 }, black: { kind: 'engine', skill: 1 } },
    }),
  );
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
await page.waitForTimeout(300);

// Espera hasta que haya al menos 4 jugadas en la lista (IA vs IA jugando).
let moves = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  moves = await page.evaluate(() => {
    const spans = document.querySelectorAll('#moves li span');
    return spans.length;
  });
  if (moves >= 4) break;
}

const setId = await page.evaluate(() => window.__adb.setId());
const status = await page.evaluate(() => document.getElementById('status')?.textContent);
const hasCanvas = await page.evaluate(() => {
  const c = document.getElementById('scene');
  try {
    return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return 'context-error';
  }
});

await page.screenshot({ path: '/tmp/adb-screenshot.png' });
await browser.close();

console.log('jugadas IA vs IA:', moves);
console.log('set activo:', setId);
console.log('estado:', status);
console.log('webgl activo:', hasCanvas);
console.log('errores:', errors.length ? errors.slice(0, 10) : 'ninguno');
process.exit(moves >= 4 && setId === 'guerreros' && errors.length === 0 ? 0 : 1);
