import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { Chess } from 'chess.js';
import { db, type LlmModelRow } from './db.js';
import { requireUser } from './auth.js';

/**
 * Jugadores LLM. Las claves API viven solo en el servidor (variables de
 * entorno por ahora; el panel de administración del hito 7 las gestionará).
 *
 * Proveedores directos: Claude (SDK de Anthropic), OpenAI y DeepSeek
 * (API compatible OpenAI). Cualquier otro modelo entra vía OpenRouter
 * (también compatible OpenAI): OPENROUTER_API_KEY + OPENROUTER_MODELS
 * con ids separados por coma (p. ej. "qwen/qwen3-32b,x-ai/grok-4").
 */

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;

// ------------------------------------------------------------------ siembra
function seed(name: string, row: Omit<LlmModelRow, 'id' | 'enabled' | 'name'>): void {
  db.prepare(
    `INSERT INTO llm_models (name, provider, base_url, model, api_key)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       provider = excluded.provider, base_url = excluded.base_url,
       model = excluded.model, api_key = excluded.api_key`,
  ).run(name, row.provider, row.base_url, row.model, row.api_key);
}

export function seedLlmModels(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    seed('Claude Opus 4.8', {
      provider: 'anthropic',
      base_url: null,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
      api_key: process.env.ANTHROPIC_API_KEY,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    seed(`OpenAI ${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}`, {
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      api_key: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    seed('DeepSeek Chat', {
      provider: 'openai',
      base_url: 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      api_key: process.env.DEEPSEEK_API_KEY,
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    const models = (process.env.OPENROUTER_MODELS ?? 'qwen/qwen3-32b')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    for (const model of models) {
      seed(`OpenRouter ${model}`, {
        provider: 'openai',
        base_url: 'https://openrouter.ai/api/v1',
        model,
        api_key: process.env.OPENROUTER_API_KEY,
      });
    }
  }
  if (process.env.ADB_DEV === '1') {
    seed('IA de prueba (mock)', {
      provider: 'mock',
      base_url: null,
      model: 'mock',
      api_key: null,
    });
  }
}

// -------------------------------------------------------------- proveedores
const anthropicClients = new Map<string, Anthropic>();

async function completeAnthropic(row: LlmModelRow, system: string, user: string): Promise<string> {
  let client = anthropicClients.get(row.api_key!);
  if (!client) {
    client = new Anthropic({ apiKey: row.api_key!, timeout: REQUEST_TIMEOUT_MS });
    anthropicClients.set(row.api_key!, client);
  }
  const response = await client.messages.create({
    model: row.model,
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó la petición');
  }
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function completeOpenAI(row: LlmModelRow, system: string, user: string): Promise<string> {
  const res = await fetch(`${row.base_url}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${row.api_key}`,
      'content-type': 'application/json',
      // Cabeceras de atribución de OpenRouter (ignoradas por otros proveedores)
      'x-title': 'Ajedrez de Batalla',
    },
    body: JSON.stringify({
      model: row.model,
      max_tokens: 1000,
      temperature: 0.6,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Proveedor LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta del proveedor sin contenido');
  return text;
}

function completeMock(chess: Chess): string {
  // Determinista y siempre legal: prefiere capturas, si no la primera jugada.
  const moves = chess.moves({ verbose: true });
  const capture = moves.find((m) => m.captured);
  return (capture ?? moves[0]).san;
}

// ------------------------------------------------------------------ ajedrez
function buildPrompt(chess: Chess, history: string[], feedback: string | null) {
  const color = chess.turn() === 'w' ? 'blancas' : 'negras';
  const system =
    `Eres un gran maestro de ajedrez jugando con las ${color}. ` +
    'Responde ÚNICAMENTE con tu siguiente jugada en notación algebraica SAN ' +
    '(ejemplos: e4, Nf3, exd5, O-O, e8=Q). Sin explicaciones, sin comentarios, solo la jugada.';

  const numbered: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    numbered.push(`${i / 2 + 1}. ${history[i]}${history[i + 1] ? ` ${history[i + 1]}` : ''}`);
  }
  let user =
    `Posición actual (FEN): ${chess.fen()}\n` +
    `Historial: ${numbered.join(' ') || '(inicio de la partida)'}\n` +
    `Tus jugadas legales: ${chess.moves().join(', ')}\n`;
  if (feedback) user += `\n${feedback}\n`;
  user += 'Tu jugada:';
  return { system, user };
}

/** Extrae una jugada legal del texto del modelo; null si no hay ninguna. */
function parseMove(chess: Chess, raw: string) {
  const cleaned = raw.replace(/[*`"'.]/g, ' ').trim();
  const candidates = [cleaned, ...cleaned.split(/\s+/)].filter(Boolean).slice(0, 12);
  for (const token of candidates) {
    try {
      return chess.move(token, { strict: false });
    } catch {
      /* token no es jugada legal; probar el siguiente */
    }
  }
  return null;
}

// -------------------------------------------------------------------- rutas
const moveSchema = {
  body: {
    type: 'object',
    required: ['modelId', 'fen'],
    properties: {
      modelId: { type: 'integer' },
      fen: { type: 'string', maxLength: 120 },
      history: { type: 'array', items: { type: 'string', maxLength: 12 }, maxItems: 600 },
    },
  },
} as const;

export function llmRoutes(app: FastifyInstance): void {
  app.get('/api/llm/models', async () => {
    const rows = db
      .prepare('SELECT id, name FROM llm_models WHERE enabled = 1 ORDER BY name')
      .all() as { id: number; name: string }[];
    return rows;
  });

  app.post('/api/llm/move', { schema: moveSchema }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const { modelId, fen, history = [] } = req.body as {
      modelId: number;
      fen: string;
      history?: string[];
    };
    const row = db
      .prepare('SELECT * FROM llm_models WHERE id = ? AND enabled = 1')
      .get(modelId) as LlmModelRow | undefined;
    if (!row) return reply.code(404).send({ error: 'modelo-no-existe' });

    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return reply.code(400).send({ error: 'fen-invalido' });
    }
    if (chess.isGameOver()) return reply.code(400).send({ error: 'partida-terminada' });

    if (row.provider === 'mock') {
      const move = chess.move(completeMock(chess));
      return { san: move.san, from: move.from, to: move.to, promotion: move.promotion, attempts: 1 };
    }

    let feedback: string | null = null;
    let lastRaw = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { system, user: prompt } = buildPrompt(chess, history, feedback);
      let raw: string;
      try {
        raw =
          row.provider === 'anthropic'
            ? await completeAnthropic(row, system, prompt)
            : await completeOpenAI(row, system, prompt);
      } catch (err) {
        req.log.error({ err, model: row.name }, 'fallo del proveedor LLM');
        return reply.code(502).send({
          error: 'proveedor-llm',
          detail: err instanceof Error ? err.message.slice(0, 300) : 'desconocido',
        });
      }
      lastRaw = raw.trim().slice(0, 200);
      const move = parseMove(chess, raw);
      if (move) {
        return {
          san: move.san,
          from: move.from,
          to: move.to,
          promotion: move.promotion,
          attempts: attempt,
        };
      }
      feedback =
        `Tu respuesta anterior ("${lastRaw.slice(0, 60)}") no es una jugada legal. `
        + 'Elige exactamente una de las jugadas legales listadas.';
    }

    // El modelo no dio una jugada legal: jugada aleatoria para no colgar la partida.
    const legal = chess.moves();
    const fallbackSan = legal[Math.floor(Math.random() * legal.length)];
    const move = chess.move(fallbackSan);
    req.log.warn({ model: row.name, lastRaw }, 'LLM sin jugada legal; se usa una aleatoria');
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      attempts: MAX_ATTEMPTS,
      fallback: true,
    };
  });
}
