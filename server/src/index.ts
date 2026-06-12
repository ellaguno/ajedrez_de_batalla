import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './auth.js';
import { gameRoutes } from './games.js';
import { adminRoutes } from './admin.js';
import { llmRoutes, seedLlmModels } from './llm.js';
import { onlineRoutes } from './online.js';
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

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
