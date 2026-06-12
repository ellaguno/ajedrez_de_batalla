// Prueba de interacción humana: humano (blancas) vs IA (negras).
// Clic en e2, clic en e4 → debe registrarse "e4" y la IA responder.
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PORT = process.env.SMOKE_PORT ?? '4173';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.addInitScript(() => {
  if (!localStorage.getItem('adb.partida.v1')) {
    localStorage.setItem(
      'adb.partida.v1',
      JSON.stringify({
        pgn: '',
        config: { white: { kind: 'human' }, black: { kind: 'engine', skill: 1 } },
      }),
    );
  }
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
await page.waitForTimeout(300);

async function clickSquare(square) {
  const { x, y } = await page.evaluate((s) => window.__adb.projectSquare(s), square);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

await clickSquare('e2');
await clickSquare('e4');

// Espera la respuesta de la IA (2 medias jugadas en la lista).
let spans = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  spans = await page.evaluate(() => document.querySelectorAll('#moves li span').length);
  if (spans >= 2) break;
}
const fen = await page.evaluate(() => window.__adb.fen());
const moveList = await page.evaluate(() =>
  [...document.querySelectorAll('#moves li span')].map((s) => s.textContent).join(' '),
);

// Recarga: la partida debe reanudarse desde localStorage.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__adb?.ready?.(), { timeout: 20000 });
await page.waitForTimeout(300);
const spansAfterReload = await page.evaluate(
  () => document.querySelectorAll('#moves li span').length,
);

await browser.close();
console.log('jugadas:', moveList);
console.log('fen:', fen);
console.log('jugadas tras recargar:', spansAfterReload);
console.log('errores:', errors.length ? errors : 'ninguno');
const ok = moveList.startsWith('e4') && spans >= 2 && spansAfterReload >= 2 && errors.length === 0;
process.exit(ok ? 0 : 1);
