// Prueba de API (sin navegador): registro → correo de verificación (buzón
// dev) → verificar → login con cookie → CRUD de partidas → logout.
const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;

let cookie = '';
const checks = [];
function check(name, cond, extra = '') {
  checks.push([name, cond]);
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}${extra ? ` (${extra})` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: body ? { 'content-type': 'application/json', cookie } : { cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* redirects no traen json */
  }
  return { status: res.status, data, headers: res.headers };
}

const email = `prueba+${process.pid}@example.com`;
const password = 'contraseña-segura-123';

// Registro
const reg = await api('POST', '/api/auth/register', { email, password, name: 'Probador' });
check('registro responde ok', reg.status === 200 && reg.data?.ok === true);

// Login antes de verificar → 403
const early = await api('POST', '/api/auth/login', { email, password });
check('login sin verificar devuelve 403', early.status === 403 && early.data?.error === 'no-verificado');

// Extraer enlace de verificación del buzón dev
const mails = await api('GET', '/api/dev/mails');
const mail = mails.data?.findLast((m) => m.to === email);
const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
check('correo de verificación recibido con enlace', !!link);

// Verificar (redirige a /?verificado=1)
const verify = await fetch(link, { redirect: 'manual' });
check('verificación redirige', verify.status === 302 && verify.headers.get('location')?.includes('verificado=1'));

// Login
const login = await api('POST', '/api/auth/login', { email, password });
check('login correcto', login.status === 200 && login.data?.email === email && cookie.length > 10);

// Contraseña errónea → 401
const saveCookie = cookie;
cookie = '';
const bad = await api('POST', '/api/auth/login', { email, password: 'incorrecta-123' });
check('contraseña errónea devuelve 401', bad.status === 401);
cookie = saveCookie;

// me
const me = await api('GET', '/api/auth/me');
check('me devuelve usuario', me.status === 200 && me.data?.user?.email === email);

// CRUD partidas
const game = { name: 'Prueba vs Stockfish', pgn: '1. e4 e5 2. Nf3', config: { white: { kind: 'human' }, black: { kind: 'engine', skill: 5 } }, moves: 3 };
const created = await api('POST', '/api/games', game);
check('crear partida', created.status === 200 && Number.isInteger(created.data?.id));
const id = created.data.id;

const updated = await api('PUT', `/api/games/${id}`, { ...game, pgn: '1. e4 e5 2. Nf3 Nc6', moves: 4 });
check('actualizar partida', updated.status === 200);

const list = await api('GET', '/api/games');
check('listar partidas', list.status === 200 && list.data?.some((g) => g.id === id && g.moves === 4));

const got = await api('GET', `/api/games/${id}`);
check('leer partida con pgn y config', got.status === 200 && got.data?.pgn.includes('Nc6') && got.data?.config?.black?.skill === 5);

// Acceso ajeno: sin cookie → 401
const noAuthCookie = cookie;
cookie = '';
const denied = await api('GET', `/api/games/${id}`);
check('partidas exigen sesión', denied.status === 401);
cookie = noAuthCookie;

const del = await api('DELETE', `/api/games/${id}`);
const after = await api('GET', '/api/games');
check('borrar partida', del.status === 200 && !after.data?.some((g) => g.id === id));

// Jugadores LLM (modelo mock sembrado con ADB_DEV=1)
const models = await api('GET', '/api/llm/models');
const mock = models.data?.find((m) => m.name.includes('mock'));
check('lista de modelos LLM incluye el mock (dev)', models.status === 200 && !!mock);

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const mv = await api('POST', '/api/llm/move', { modelId: mock.id, fen: START_FEN, history: [] });
check(
  'jugada LLM válida con from/to/san',
  mv.status === 200 && typeof mv.data?.san === 'string' && !!mv.data?.from && !!mv.data?.to,
);

const noSession = cookie;
cookie = '';
const mvDenied = await api('POST', '/api/llm/move', { modelId: mock.id, fen: START_FEN });
check('jugada LLM exige sesión', mvDenied.status === 401);
cookie = noSession;

// Logout invalida la sesión
await api('POST', '/api/auth/logout', {});
const meAfter = await api('GET', '/api/auth/me');
check('logout invalida sesión', meAfter.status === 200 && meAfter.data?.user === null);

const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `✘ ${failed.length} fallos` : '✔ API OK');
process.exit(failed.length ? 1 : 0);
