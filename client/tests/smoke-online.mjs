// E2E de juego en línea: dos navegadores, A crea partida (blancas) y comparte
// el código, B se une, intercambian jugadas validadas por el árbitro y A se
// rinde; ambos ven el final.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;

async function makeAccount(tag) {
  const email = `${tag}+${process.pid}@example.com`;
  const password = `contraseña-${tag}-123`;
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: tag }),
  });
  const mails = await (await fetch(`${BASE}/api/dev/mails`)).json();
  const link = mails.findLast((m) => m.to === email)?.text.match(/https?:\/\/\S+/)?.[0];
  await fetch(link, { redirect: 'manual' });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const [name, value] = login.headers.get('set-cookie').split(';')[0].split('=');
  return { name, value };
}

const [cookieA, cookieB] = await Promise.all([makeAccount('ana'), makeAccount('beto')]);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const errors = [];

async function openPage(cookie, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ ...cookie, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
  return page;
}

const pageA = await openPage(cookieA, 'A');
const pageB = await openPage(cookieB, 'B');

const checks = [];
const check = (name, cond) => {
  checks.push([name, cond]);
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
};

// A crea partida con blancas
await pageA.click('#btn-online');
await pageA.selectOption('#online-color', 'w');
await pageA.click('#online-create');
await pageA.waitForFunction(
  () => !document.getElementById('online-code-box').hidden,
  { timeout: 10000 },
);
const code = await pageA.evaluate(() => document.getElementById('online-code').textContent);
check('A recibe código de invitación', /^[A-Z2-9]{5}$/.test(code));

// B se une
await pageB.click('#btn-online');
await pageB.fill('#online-join-code', code);
await pageB.click('#online-join');

// Ambos arrancan
await pageA.waitForFunction(
  () => !document.getElementById('btn-resign').hidden,
  { timeout: 10000 },
);
await pageB.waitForFunction(
  () => !document.getElementById('btn-resign').hidden,
  { timeout: 10000 },
);
const playersA = await pageA.evaluate(() => document.getElementById('players').textContent);
check('A ve a ambos jugadores', playersA.includes('ana') && playersA.includes('beto'));

const clickSquare = async (page, square) => {
  const { x, y } = await page.evaluate((s) => window.__adb.projectSquare(s), square);
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
};
const movesOf = (page) =>
  page.evaluate(() => document.querySelectorAll('#moves li span').length);
const waitMoves = async (page, n) => {
  for (let i = 0; i < 30; i++) {
    if ((await movesOf(page)) >= n) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

// A (blancas) juega e2→e4; debe verse en ambos tableros
await clickSquare(pageA, 'e2');
await clickSquare(pageA, 'e4');
check('la jugada de A llega a ambos', (await waitMoves(pageA, 1)) && (await waitMoves(pageB, 1)));

// B (negras) responde e7→e5
await clickSquare(pageB, 'e7');
await clickSquare(pageB, 'e5');
check('la respuesta de B llega a ambos', (await waitMoves(pageA, 2)) && (await waitMoves(pageB, 2)));

const fenA = await pageA.evaluate(() => window.__adb.fen());
const fenB = await pageB.evaluate(() => window.__adb.fen());
check('ambos tableros coinciden (árbitro)', fenA === fenB && fenA.includes('4p3/4P3'));

// A se rinde; ambos ven el final
pageA.on('dialog', (d) => void d.accept());
await pageA.click('#btn-resign');
await pageA.waitForTimeout(1000);
const bannerA = await pageA.evaluate(() => document.getElementById('banner').textContent);
const bannerB = await pageB.evaluate(() => document.getElementById('banner').textContent);
check('ambos ven la rendición', bannerA.includes('rinden') && bannerB.includes('rinden'));

await pageA.screenshot({ path: '/tmp/adb-online-a.png' });
await browser.close();
console.log('errores de consola:', errors.length ? errors : 'ninguno');
const failed = checks.filter(([, ok]) => !ok);
process.exit(failed.length || errors.length ? 1 : 0);
