// Prueba de captura animada con el set riggeado: partida humano vs humano
// reanudada en "1. e4 d5"; blancas juegan exd5 → debe ejecutarse la secuencia
// caminar/atacar/morir y registrarse la captura.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.addInitScript(() => {
  localStorage.setItem('adb.set', 'guerreros');
  localStorage.setItem(
    'adb.partida.v1',
    JSON.stringify({
      pgn: '1. e4 d5',
      config: { white: { kind: 'human' }, black: { kind: 'human' } },
    }),
  );
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
await page.waitForTimeout(300);

async function clickSquare(square) {
  const { x, y } = await page.evaluate((s) => window.__adb.projectSquare(s), square);
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const camPos = () => page.evaluate(() => window.__adb.cameraPos());

await clickSquare('e4'); // peón blanco
await page.screenshot({ path: '/tmp/adb-capture-select.png' });
const camBefore = await camPos();
await clickSquare('d5'); // captura → combate cinematográfico

// A mitad de la cinemática la cámara debe estar abajo, junto al duelo.
await page.waitForTimeout(1200);
const camDuel = await camPos();
const skipVisible = await page.evaluate(() => !document.getElementById('btn-skip').hidden);
await page.screenshot({ path: '/tmp/adb-capture-cine.png' });

// La animación de captura tarda ~4 s; espera a que se registre exd5.
let san = '';
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  san = await page.evaluate(() =>
    [...document.querySelectorAll('#moves li span')].map((s) => s.textContent).join(' '),
  );
  if (san.includes('exd5')) break;
}
await page.waitForTimeout(400);
const camAfter = await camPos();
const fen = await page.evaluate(() => window.__adb.fen());
await page.screenshot({ path: '/tmp/adb-capture-after.png' });
await browser.close();

console.log('jugadas:', san);
console.log('fen:', fen);
console.log('cámara: bajó', dist(camBefore, camDuel).toFixed(2), '| volvió a', dist(camBefore, camAfter).toFixed(2));
console.log('botón saltar visible durante cinemática:', skipVisible);
console.log('errores:', errors.length ? errors : 'ninguno');
const ok =
  san.includes('exd5') &&
  fen.includes('3P4') &&
  dist(camBefore, camDuel) > 3 && // voló al duelo
  dist(camBefore, camAfter) < 0.05 && // regresó a la vista original
  skipVisible &&
  errors.length === 0;
process.exit(ok ? 0 : 1);
