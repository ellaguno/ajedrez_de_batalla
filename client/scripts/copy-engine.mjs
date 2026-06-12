// Copia el build single-thread de Stockfish (WASM) desde node_modules a
// public/engine/, porque el worker debe cargarse como archivo estático
// (no puede pasar por el bundler). Prefiere la variante "lite" (red NNUE
// pequeña, ~6 MB) y "single" (sin SharedArrayBuffer, no exige COOP/COEP).
import { cpSync, mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let pkgDir;
try {
  pkgDir = dirname(require.resolve('stockfish/package.json'));
} catch {
  console.warn('[copy-engine] paquete "stockfish" no instalado; se omite.');
  process.exit(0);
}
// v18+ usa bin/, v16 usaba src/
const srcDir = [join(pkgDir, 'bin'), join(pkgDir, 'src')].find(existsSync);
if (!srcDir) {
  console.warn(`[copy-engine] no se encontró bin/ ni src/ en ${pkgDir}; se omite.`);
  process.exit(0);
}

const files = readdirSync(srcDir);
const candidates = files.filter((f) => f.endsWith('-single.js'));
const pick =
  candidates.find((f) => f.includes('lite')) ??
  candidates[0] ??
  files.find((f) => f.endsWith('.js'));

if (!pick) {
  console.error(`[copy-engine] no se encontró ningún build de Stockfish en ${srcDir}`);
  process.exit(1);
}

const outDir = join(here, '..', 'public', 'engine');
mkdirSync(outDir, { recursive: true });

const base = pick.replace(/\.js$/, '');
// El .wasm carga la red NNUE (nn-*.nnue) por fetch en tiempo de ejecución.
const toCopy = files.filter((f) => f.startsWith(base) || f.endsWith('.nnue'));
for (const f of toCopy) {
  cpSync(join(srcDir, f), join(outDir, f));
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ js: pick }, null, 2));
console.log(`[copy-engine] copiado: ${toCopy.join(', ')} -> public/engine/`);
