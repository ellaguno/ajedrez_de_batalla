import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, type LlmModelRow } from './db.js';
import { requireAdmin } from './auth.js';

/**
 * Administración: gestión de modelos LLM (con sus claves API) y subida de
 * sets de piezas. Un set se sube como ZIP con set.json + los .glb que
 * declara; queda en data/sets/ y se sirve bajo /usersets/. El catálogo
 * /sets/index.json se genera dinámicamente fusionando los sets de fábrica
 * con los subidos.
 */

const here = dirname(fileURLToPath(import.meta.url));
const setsDir = process.env.ADB_SETS_DIR ?? join(here, '..', 'data', 'sets');
const clientDist = process.env.ADB_CLIENT_DIST ?? join(here, '..', '..', 'client', 'dist');

const SET_ID = /^[a-z0-9][a-z0-9-]{1,29}$/;
const MAX_ZIP_BYTES = 80 * 1024 * 1024;

interface SetManifest {
  id: string;
  name: string;
  pieces: Record<string, { model: string }>;
}

const maskedModel = (m: LlmModelRow) => ({
  id: m.id,
  name: m.name,
  provider: m.provider,
  baseUrl: m.base_url,
  model: m.model,
  hasKey: !!m.api_key,
  enabled: m.enabled === 1,
});

function uploadedSets(): { id: string; name: string; base: string }[] {
  if (!existsSync(setsDir)) return [];
  const out: { id: string; name: string; base: string }[] = [];
  for (const dir of readdirSync(setsDir)) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(setsDir, dir, 'set.json'), 'utf8'),
      ) as SetManifest;
      out.push({ id: dir, name: manifest.name ?? dir, base: `/usersets/${dir}` });
    } catch {
      /* directorio sin set.json válido: se ignora */
    }
  }
  return out;
}

const llmBodySchema = {
  body: {
    type: 'object',
    required: ['name', 'provider', 'model'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      provider: { type: 'string', enum: ['openai', 'anthropic'] },
      baseUrl: { type: 'string', maxLength: 300 },
      model: { type: 'string', minLength: 1, maxLength: 120 },
      apiKey: { type: 'string', maxLength: 400 },
      enabled: { type: 'boolean' },
    },
  },
} as const;

interface LlmBody {
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl?: string;
  model: string;
  apiKey?: string;
  enabled?: boolean;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_ZIP_BYTES, files: 1 } });
  mkdirSync(setsDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: setsDir,
    prefix: '/usersets/',
    decorateReply: false,
  });

  // Catálogo dinámico: sets de fábrica (dist) + sets subidos.
  app.get('/sets/index.json', async () => {
    let builtin: { sets: unknown[] } = { sets: [] };
    try {
      builtin = JSON.parse(readFileSync(join(clientDist, 'sets', 'index.json'), 'utf8'));
    } catch {
      /* sin build del cliente (dev puro): solo sets subidos */
    }
    return { sets: [...builtin.sets, ...uploadedSets()] };
  });

  // ------------------------------------------------------------ modelos LLM
  app.get('/api/admin/llm', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db.prepare('SELECT * FROM llm_models ORDER BY name').all() as LlmModelRow[];
    return rows.map(maskedModel);
  });

  app.post('/api/admin/llm', { schema: llmBodySchema }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = req.body as LlmBody;
    if (b.provider === 'openai' && !b.baseUrl) {
      return reply.code(400).send({ error: 'base-url-requerida' });
    }
    try {
      const info = db
        .prepare(
          'INSERT INTO llm_models (name, provider, base_url, model, api_key, enabled) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(b.name, b.provider, b.baseUrl ?? null, b.model, b.apiKey ?? null, b.enabled === false ? 0 : 1);
      return { id: Number(info.lastInsertRowid) };
    } catch {
      return reply.code(409).send({ error: 'nombre-duplicado' });
    }
  });

  app.put('/api/admin/llm/:id', { schema: llmBodySchema }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id) as
      | LlmModelRow
      | undefined;
    if (!row) return reply.code(404).send({ error: 'no-existe' });
    const b = req.body as LlmBody;
    db.prepare(
      `UPDATE llm_models SET name = ?, provider = ?, base_url = ?, model = ?,
       api_key = ?, enabled = ? WHERE id = ?`,
    ).run(
      b.name,
      b.provider,
      b.baseUrl ?? null,
      b.model,
      // Clave vacía u omitida = conservar la actual.
      b.apiKey ? b.apiKey : row.api_key,
      b.enabled === false ? 0 : 1,
      id,
    );
    return { ok: true };
  });

  app.delete('/api/admin/llm/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    db.prepare('DELETE FROM llm_models WHERE id = ?').run(id);
    return { ok: true };
  });

  // ------------------------------------------------------------------- sets
  app.get('/api/admin/sets', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return uploadedSets();
  });

  app.post('/api/admin/sets', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'archivo-requerido' });
    const buffer = await file.toBuffer();

    let zip: AdmZip;
    let manifest: SetManifest;
    try {
      zip = new AdmZip(buffer);
      const entry = zip.getEntry('set.json');
      if (!entry) return reply.code(400).send({ error: 'falta-set-json' });
      manifest = JSON.parse(entry.getData().toString('utf8')) as SetManifest;
    } catch {
      return reply.code(400).send({ error: 'zip-invalido' });
    }

    if (!SET_ID.test(manifest.id ?? '')) {
      return reply.code(400).send({ error: 'id-invalido' });
    }
    if (!manifest.name || !manifest.pieces) {
      return reply.code(400).send({ error: 'manifiesto-incompleto' });
    }
    const models = Object.values(manifest.pieces).map((p) => p.model);
    if (models.length < 6) return reply.code(400).send({ error: 'faltan-piezas' });
    for (const model of models) {
      if (!/^[\w-]+\.glb$/i.test(model) || !zip.getEntry(model)) {
        return reply.code(400).send({ error: 'falta-modelo', detail: model });
      }
    }

    const dest = join(setsDir, manifest.id);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'set.json'), JSON.stringify(manifest, null, 2));
    for (const model of new Set(models)) {
      writeFileSync(join(dest, model), zip.getEntry(model)!.getData());
    }
    return { ok: true, id: manifest.id };
  });

  app.delete('/api/admin/sets/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    if (!SET_ID.test(id)) return reply.code(400).send({ error: 'id-invalido' });
    const dest = join(setsDir, id);
    if (!existsSync(dest)) return reply.code(404).send({ error: 'no-existe' });
    rmSync(dest, { recursive: true, force: true });
    return { ok: true };
  });
}
