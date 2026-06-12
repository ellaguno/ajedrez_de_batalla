// E2E de jugadores LLM: cuenta verificada por API, sesión inyectada en el
// navegador, nueva partida "IA de prueba (mock)" vs la misma → la partida
// se juega sola pasando por POST /api/llm/move.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;

const email = `llm+${process.pid}@example.com`;
const password = 'contraseña-llm-123';

// Cuenta verificada + cookie de sesión, todo por API.
await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const mails = await (await fetch(`${BASE}/api/dev/mails`)).json();
const link = mails.findLast((m) => m.to === email)?.text.match(/https?:\/\/\S+/)?.[0];
await fetch(link, { redirect: 'manual' });
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const sessionCookie = login.headers.get('set-cookie').split(';')[0].split('=');

const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addCookies([
  {
    name: sessionCookie[0],
    value: sessionCookie[1],
    url: BASE,
    httpOnly: true,
    sameSite: 'Lax',
  },
]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });

const checks = [];
const check = (name, cond) => {
  checks.push([name, cond]);
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
};

check('sesión activa en el navegador', !!(await page.evaluate(() => window.__adb.user())));

// Nueva partida: mock vs mock.
await page.click('#btn-new');
const llmOption = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('#cfg-white option')].find((o) =>
    o.value.startsWith('llm:'),
  );
  return opt?.value ?? null;
});
check('el diálogo ofrece modelos LLM', llmOption !== null);

await page.selectOption('#cfg-white', llmOption);
await page.selectOption('#cfg-black', llmOption);
await page.click('#btn-start');

// La partida debe jugarse sola (cada jugada pasa por el servidor).
let spans = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  spans = await page.evaluate(() => document.querySelectorAll('#moves li span').length);
  if (spans >= 6) break;
}
check('LLM vs LLM produce jugadas (≥6 medias jugadas)', spans >= 6);

const players = await page.evaluate(() => document.getElementById('players').textContent);
check('el panel muestra el modelo LLM', players.includes('mock'));

await page.screenshot({ path: '/tmp/adb-llm.png' });
await browser.close();
console.log('errores de consola:', errors.length ? errors : 'ninguno');
const failed = checks.filter(([, ok]) => !ok);
process.exit(failed.length || errors.length ? 1 : 0);
