// E2E de cuenta en navegador: registro+verificación por API, login por la UI,
// autosave de la partida al servidor tras mover, "Mis partidas" y repetición.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;

const email = `cuenta+${process.pid}@example.com`;
const password = 'contraseña-e2e-123';

// Registro + verificación por API (la UI de esto ya la cubre smoke-api).
await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, name: 'E2E' }),
});
const mails = await (await fetch(`${BASE}/api/dev/mails`)).json();
const link = mails.findLast((m) => m.to === email)?.text.match(/https?:\/\/\S+/)?.[0];
await fetch(link, { redirect: 'manual' });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
await page.waitForTimeout(300);

const checks = [];
const check = (name, cond) => {
  checks.push([name, cond]);
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
};

// Login por la UI
await page.click('#btn-user');
await page.fill('#auth-email', email);
await page.fill('#auth-pass', password);
await page.click('#auth-submit');
await page.waitForTimeout(800);
const user = await page.evaluate(() => window.__adb.user());
check('login por la UI', user?.email === email);
check('botón Mis partidas visible', await page.evaluate(() => !document.getElementById('btn-games').hidden));

// Jugar e2-e4 (humano vs Stockfish por defecto) → autosave al servidor
const clickSquare = async (s) => {
  const { x, y } = await page.evaluate((q) => window.__adb.projectSquare(q), s);
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
};
await clickSquare('e2');
await clickSquare('e4');
let gameId = null;
for (let i = 0; i < 30 && !gameId; i++) {
  await page.waitForTimeout(500);
  gameId = await page.evaluate(() => window.__adb.serverGameId());
}
check('autosave creó partida en el servidor', Number.isInteger(gameId));

// Mis partidas: la partida aparece
await page.click('#btn-games');
await page.waitForTimeout(600);
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('#games-list li:not(.empty)')].map(
    (li) => li.querySelector('.game-name')?.textContent ?? '',
  ),
);
check('la partida aparece en Mis partidas', rows.length >= 1 && rows[0].includes('Humano'));

// Repetición: entrar, avanzar una jugada, salir
await page.click('#games-list li button:nth-of-type(2)'); // "Repetir"
await page.waitForTimeout(600);
let rp = await page.evaluate(() => window.__adb.replay());
const barVisible = await page.evaluate(() => !document.getElementById('replay-bar').hidden);
check('modo repetición activo', barVisible && rp && rp.total >= 2 && rp.index === 0);

await page.click('#rp-next');
await page.waitForTimeout(1500);
rp = await page.evaluate(() => window.__adb.replay());
check('avanza una jugada en la repetición', rp?.index === 1);

await page.click('#rp-exit');
await page.waitForTimeout(400);
rp = await page.evaluate(() => window.__adb.replay());
check('salir de la repetición', rp === null);

// Cerrar sesión
await page.click('#btn-user');
await page.click('#profile-logout');
await page.waitForTimeout(500);
check('cerrar sesión', (await page.evaluate(() => window.__adb.user())) === null);

await browser.close();
console.log('errores de consola:', errors.length ? errors : 'ninguno');
const failed = checks.filter(([, ok]) => !ok);
process.exit(failed.length || errors.length ? 1 : 0);
