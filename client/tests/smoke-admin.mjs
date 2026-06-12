// E2E de administración: rol admin por ADB_ADMIN_EMAIL, CRUD de modelos LLM
// reflejado en la lista pública, subida de un set ZIP que aparece en el
// catálogo y carga en el juego, y página /admin.html.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));

const checks = [];
const check = (name, cond) => {
  checks.push([name, cond]);
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
};

async function makeAccount(email, password) {
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
  return { cookie: login.headers.get('set-cookie').split(';')[0], body: await login.json() };
}

const admin = await makeAccount('admin@example.com', 'clave-admin-123');
const normal = await makeAccount(`normal+${process.pid}@example.com`, 'clave-normal-123');

check('ADB_ADMIN_EMAIL otorga rol admin', admin.body.admin === true);
check('usuario normal no es admin', !normal.body.admin);

const apiAs = async (cookie, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body
      ? { 'content-type': 'application/json', cookie }
      : { cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// Control de acceso
const denied = await apiAs(normal.cookie, 'GET', '/api/admin/llm');
check('endpoints admin devuelven 403 a no-admins', denied.status === 403);

// CRUD de modelos LLM
const created = await apiAs(admin.cookie, 'POST', '/api/admin/llm', {
  name: 'Modelo Prueba Admin',
  provider: 'openai',
  baseUrl: 'https://ejemplo.invalido/v1',
  model: 'modelo-prueba',
  apiKey: 'sk-de-prueba',
});
check('crear modelo LLM', created.status === 200 && Number.isInteger(created.data?.id));
const modelId = created.data.id;

let publicList = await (await fetch(`${BASE}/api/llm/models`)).json();
check('el modelo aparece en la lista pública', publicList.some((m) => m.name === 'Modelo Prueba Admin'));

const adminList = await apiAs(admin.cookie, 'GET', '/api/admin/llm');
const mine = adminList.data?.find((m) => m.id === modelId);
check('la lista admin enmascara la clave', mine?.hasKey === true && !JSON.stringify(mine).includes('sk-de-prueba'));

await apiAs(admin.cookie, 'PUT', `/api/admin/llm/${modelId}`, {
  name: 'Modelo Prueba Admin',
  provider: 'openai',
  baseUrl: 'https://ejemplo.invalido/v1',
  model: 'modelo-prueba',
  enabled: false,
});
publicList = await (await fetch(`${BASE}/api/llm/models`)).json();
check('desactivar lo quita de la lista pública', !publicList.some((m) => m.id === modelId));

await apiAs(admin.cookie, 'DELETE', `/api/admin/llm/${modelId}`);
const afterDelete = await apiAs(admin.cookie, 'GET', '/api/admin/llm');
check('borrar modelo', !afterDelete.data?.some((m) => m.id === modelId));

// Subida de set (ZIP construido desde el set guerreros con otro id)
const srcDir = join(here, '..', 'public', 'sets', 'guerreros');
const manifest = JSON.parse(readFileSync(join(srcDir, 'set.json'), 'utf8'));
manifest.id = 'guerreros-arena';
manifest.name = 'Guerreros Arena';
const zip = new AdmZip();
zip.addFile('set.json', Buffer.from(JSON.stringify(manifest)));
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.glb'))) {
  zip.addFile(f, readFileSync(join(srcDir, f)));
}
const form = new FormData();
form.append('archivo', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'set.zip');
const upload = await fetch(`${BASE}/api/admin/sets`, {
  method: 'POST',
  headers: { cookie: admin.cookie },
  body: form,
});
check('subir set ZIP', upload.status === 200 && (await upload.json()).id === 'guerreros-arena');

const index = await (await fetch(`${BASE}/sets/index.json`)).json();
const uploaded = index.sets.find((s) => s.id === 'guerreros-arena');
check('el set aparece en el catálogo', uploaded?.base === '/usersets/guerreros-arena');
const glb = await fetch(`${BASE}/usersets/guerreros-arena/pawn.glb`);
check('los GLB del set se sirven', glb.status === 200);

// En el juego: el set subido se puede seleccionar y cargar
const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const [name, value] = admin.cookie.split('=');
await context.addCookies([{ name, value, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
check('el admin ve el enlace ⚙️', await page.evaluate(() => !document.getElementById('btn-admin').hidden));
await page.selectOption('#set-select', 'guerreros-arena');
await page.waitForFunction(() => window.__adb.setId() === 'guerreros-arena', { timeout: 15000 });
check('el set subido carga en el juego', true);

// Página de administración
await page.goto(`${BASE}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('admin-main').hidden, { timeout: 10000 });
const setRows = await page.evaluate(() => document.getElementById('sets-list').textContent);
check('admin.html lista el set subido', setRows.includes('Guerreros Arena'));
await page.screenshot({ path: '/tmp/adb-admin.png' });
await browser.close();

// Limpieza: borrar el set subido
await apiAs(admin.cookie, 'DELETE', '/api/admin/sets/guerreros-arena');
const indexAfter = await (await fetch(`${BASE}/sets/index.json`)).json();
check('borrar set', !indexAfter.sets.some((s) => s.id === 'guerreros-arena'));

console.log('errores de consola:', errors.length ? errors : 'ninguno');
const failed = checks.filter(([, ok]) => !ok);
process.exit(failed.length || errors.length ? 1 : 0);
