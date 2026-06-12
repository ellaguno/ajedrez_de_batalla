// Runner de pruebas de humo: arranca el servidor (que sirve el build del
// cliente y la API con una base de datos temporal), ejecuta las pruebas y
// lo apaga. Requiere `npm run build` previo y Google Chrome/Chromium.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..', '..', 'server');
const PORT = process.env.SMOKE_PORT ?? '4173';
const DB = `/tmp/adb-smoke-${process.pid}.sqlite`;

const server = spawn('node', [join(serverDir, 'dist', 'index.js')], {
  env: {
    ...process.env,
    PORT,
    ADB_DEV: '1',
    ADB_DB: DB,
    LOG_LEVEL: 'warn',
  },
  stdio: 'inherit',
});

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return;
    } catch {
      /* aún no levanta */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('el servidor no levantó');
}

const TESTS = [
  'smoke-api.mjs',
  'smoke.mjs',
  'smoke-human.mjs',
  'smoke-capture.mjs',
  'smoke-account.mjs',
  'smoke-llm.mjs',
];

let failed = false;
try {
  await waitForServer();
  for (const test of TESTS) {
    console.log(`\n=== ${test} ===`);
    const code = await new Promise((resolve) => {
      const p = spawn('node', [join(here, test)], {
        stdio: 'inherit',
        env: { ...process.env, SMOKE_PORT: PORT },
      });
      p.on('exit', resolve);
    });
    if (code !== 0) failed = true;
  }
} finally {
  server.kill();
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB + suffix, { force: true });
}
console.log(failed ? '\n❌ Pruebas de humo con fallos' : '\n✅ Pruebas de humo OK');
process.exit(failed ? 1 : 0);
