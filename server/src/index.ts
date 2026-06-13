import './env.js'; // primero: carga .env antes de que otros módulos lean process.env
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Carga sencilla de .env (sin dependencia externa). Busca primero en
// server/.env y luego en la raíz del repo. Las variables ya presentes en
// process.env tienen prioridad (entorno real > archivo).
const hereForEnv = dirname(fileURLToPath(import.meta.url));
for (const candidate of [
  join(hereForEnv, '..', '.env'),
  join(hereForEnv, '..', '..', '.env'),
]) {
  if (!existsSync(candidate)) continue;
  for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

import { authRoutes } from './auth.js';
import { gameRoutes } from './games.js';
import { adminRoutes } from './admin.js';
import { llmRoutes, seedLlmModels } from './llm.js';
import { onlineRoutes } from './online.js';
import { libraryRoutes, seedLibrary } from './library.js';
import { devMails } from './mailer.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cookie);

app.get('/api/health', async () => ({ ok: true }));

authRoutes(app);
gameRoutes(app);
seedLlmModels();
llmRoutes(app);
await onlineRoutes(app);
await adminRoutes(app);
seedLibrary();
libraryRoutes(app);

// Endpoints solo-desarrollo (los usan las pruebas para leer el correo simulado).
if (process.env.ADB_DEV === '1') {
  app.get('/api/dev/mails', async () => devMails());
}

// Servir el cliente compilado (producción / pruebas). En desarrollo el cliente
// corre con `vite dev` y proxy de /api hacia este servidor.
const clientDist = process.env.ADB_CLIENT_DIST ?? join(here, '..', '..', 'client', 'dist');
if (existsSync(join(clientDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'no-existe' });
  });
}

// Puerto poco común a propósito: 3000/3001 suelen estar ocupados por otros
// proyectos en desarrollo (Next.js, etc.).
const port = Number(process.env.PORT ?? 8731);
const host = process.env.HOST ?? '127.0.0.1';
try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  app.log.error(
    `¿Puerto ${port} ocupado? Arranca con otro: PORT=8732 npm run dev (y ajusta el proxy de vite si lo cambias de forma permanente)`,
  );
  process.exit(1);
}
