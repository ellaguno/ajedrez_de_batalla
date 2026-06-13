import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carga variables desde un archivo `.env` (raíz del repo o carpeta server/)
 * ANTES de que el resto de los módulos lean process.env. Las variables ya
 * presentes en el entorno real tienen prioridad y nunca se sobreescriben.
 *
 * Este módulo debe ser el PRIMER import de index.ts: los imports se evalúan
 * en orden y otros módulos (admin.ts, db.ts…) leen process.env al cargar.
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.ADB_ENV_FILE,
  join(here, '..', '.env'), // server/.env
  join(here, '..', '..', '.env'), // .env en la raíz del repo
].filter((p): p is string => Boolean(p));

for (const file of candidates) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
