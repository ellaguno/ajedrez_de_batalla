# Ajedrez de Batalla

Juego de ajedrez 3D vía web inspirado en el clásico *Battle Chess* (1988): un ajedrez
completo y serio, pero donde las capturas se resuelven con secuencias de combate
cinematográficas entre piezas animadas.

## Decisiones de arquitectura

| Tema | Decisión | Motivo |
|---|---|---|
| Plataforma | Web (navegador) con **three.js** + TypeScript + Vite | Cero instalación, integración natural con cuentas, juego en línea y APIs de LLMs |
| Rendering | **Tiempo real en GPU** (WebGL), modelos glTF/GLB con esqueletos | Un solo asset por pieza sirve para tablero y combate; los sets intercambiables son triviales. El pre-renderizado exigiría cientos de videos por set (atacante × víctima × color) |
| Reglas de ajedrez | **chess.js** | Implementación legal completa y probada (enroque, al paso, promoción, tablas) |
| Motor IA clásico | **Stockfish 18 lite** (WASM single-thread, en Web Worker) | Corre en el navegador, fuerza ajustable (Skill Level 0–20), ~7 MB con la red NNUE embebida, no exige cabeceras COOP/COEP |
| Backend (futuro) | **Node.js + TypeScript** | Comparte la lógica de ajedrez con el cliente; WebSockets para juego en línea |

## Estructura

```
ajedrez_de_batalla/
├── client/            # Aplicación web (Vite + TypeScript + three.js)
│   ├── public/engine/ # Stockfish WASM (se copia desde node_modules en postinstall)
│   └── src/
│       ├── game/      # Lógica de partida: controlador, motor Stockfish
│       ├── scene/     # Escena 3D: tablero, piezas, cámara, animaciones
│       ├── ui/        # HUD HTML/CSS: estado, lista de jugadas, diálogos
│       └── storage.ts # Guardado/reanudación de partida (localStorage)
├── server/            # API: cuentas (email+sesiones), partidas guardadas (Fastify+SQLite)
└── shared/            # (futuro) Tipos y lógica compartida cliente/servidor
```

## Cómo ejecutar

```bash
npm install        # instala dependencias y copia el motor Stockfish
npm run dev        # web (vite, :5173 con proxy /api) + api (fastify, :8731)
npm run build      # build de producción (client/dist + server/dist)
npm start          # producción: el servidor sirve client/dist y la API

# Pruebas de humo (requiere build previo y Chrome):
npm run test:smoke --workspace=client
```

### Variables de entorno del servidor

Pueden definirse en el entorno o en un archivo **`.env`** en la raíz del repo
(o en `server/`) — copiar `.env.example` a `.env` y ajustar. El servidor lo lee
al arrancar; las variables del entorno real tienen prioridad, y `.env` está en
`.gitignore` (ahí van las claves API sin riesgo de subirlas).

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | Puerto/host de escucha (8731 / 127.0.0.1) |
| `ADB_DB` | Ruta del SQLite (por defecto `server/data/adb.sqlite`) |
| `BASE_URL` | URL pública para los enlaces de los correos |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Envío real de correo; sin `SMTP_HOST`, los correos se vuelcan a consola |
| `ADB_DEV=1` | Endpoints de desarrollo (`/api/dev/mails`) y modelo LLM de prueba; lo usan las pruebas |
| `ANTHROPIC_API_KEY` (+`ANTHROPIC_MODEL`) | Jugador Claude directo (por defecto `claude-opus-4-8`) |
| `OPENAI_API_KEY` (+`OPENAI_MODEL`) | Jugador OpenAI directo (por defecto `gpt-4o-mini`) |
| `DEEPSEEK_API_KEY` (+`DEEPSEEK_MODEL`) | Jugador DeepSeek directo (por defecto `deepseek-chat`) |
| `OPENROUTER_API_KEY` + `OPENROUTER_MODELS` | Cualquier otra IA vía OpenRouter; ids separados por coma, p. ej. `qwen/qwen3-32b,x-ai/grok-4` |
| `ADB_ADMIN_EMAIL` | Correos (separados por coma) con rol de administrador |
| `ADB_SETS_DIR` | Carpeta de sets subidos (por defecto `server/data/sets`) |

Los modelos se siembran en la tabla `llm_models` al arrancar el servidor
(el panel de administración del hito 7 permitirá gestionarlos sin variables
de entorno).

## Hoja de ruta

- [x] **Hito 1 — Núcleo jugable**: ajedrez legal completo, tablero 3D con piezas
  placeholder, Humano vs Humano local, Humano vs Stockfish, IA vs IA (Stockfish con
  niveles distintos), guardar/reanudar partida local, deshacer, tema claro/oscuro.
- [x] **Hito 2 — Pipeline de assets**: piezas glTF con esqueletos y clips de animación
  (idle, caminar, atacar, morir, ganar). Formato de "set de piezas" intercambiable
  (`set.json`: modelos + clips + colores del tablero), selector de set en la UI,
  set de referencia "Guerreros Geométricos" generado por script
  (`npm run generate:set`) y set "Clásico" procedural como fallback. Las capturas
  ya ejecutan la secuencia caminar → atacar → morir.
- [x] **Hito 3 — Combate cinematográfico**: en cada captura la cámara vuela a un
  plano lateral bajo del duelo, hace un travelling orbital lento durante el
  combate y regresa a la vista del jugador. Se puede saltar (botón o `Esc`,
  acelera el resto de la acción) y desactivar por completo desde el panel
  (preferencia persistida).
- [x] **Hito 4 — Backend y cuentas**: servidor Fastify + SQLite con registro,
  confirmación por email y sesiones (cookie httpOnly, scrypt). Con sesión
  iniciada, la partida se guarda sola en el servidor; el diálogo "Mis partidas"
  permite continuarla, repetirla jugada a jugada (modo repetición ⏮◀▶⏭, con
  cinemáticas) o borrarla.
- [x] **Hito 5 — Juego en línea**: persona contra persona vía WebSockets con el
  servidor como árbitro: mantiene el estado autoritativo, valida cada jugada con
  chess.js y la difunde; los clientes solo aplican jugadas confirmadas. Partidas
  por código de invitación (botón "Jugar en línea", requiere sesión), elección de
  color, rendición, aviso de rival conectado/desconectado y reconexión automática
  tras recargar (las partidas sobreviven incluso a reinicios del servidor).
- [x] **Hito 6 — IAs LLM**: jugadores LLM en el diálogo de nueva partida, en
  cualquier combinación (humano/Stockfish/LLM contra humano/Stockfish/LLM).
  Proveedores directos: **Claude** (SDK Anthropic), **OpenAI** y **DeepSeek**;
  cualquier otro modelo vía **OpenRouter** (`OPENROUTER_MODELS`). Las claves API
  viven solo en el servidor; cada jugada se pide con FEN + historial + jugadas
  legales, se valida con chess.js y se reintenta con feedback ante jugadas
  ilegales (con jugada aleatoria como último recurso para no colgar la partida).
  Requiere sesión iniciada.
- [x] **Hito 7 — Administración**: página `/admin.html` (enlace ⚙️ en el juego,
  solo administradores — designados con `ADB_ADMIN_EMAIL`). Gestiona los modelos
  LLM con sus claves API desde la UI (alta, edición, activar/desactivar, borrado;
  las claves nunca se devuelven al navegador) y permite subir nuevos sets de
  piezas como ZIP (`set.json` + los `.glb` que declara), que aparecen al instante
  en el selector del juego y se sirven desde `/usersets/`.

## Pipeline de assets 3D (hito 2)

> 📖 **Manual completo para editar y crear sets** (Blender, Mixamo, IA,
> empaquetado y solución de problemas): [docs/MANUAL-SETS.md](docs/MANUAL-SETS.md).
> Nota rápida: los GLB se abren en Blender con `File > Import > glTF 2.0`,
> no con `File > Open`.

Cada **set de piezas** vive en `client/public/sets/<id>/` con un `set.json`:

```json
{
  "format": 1,
  "id": "guerreros",
  "name": "Guerreros Geométricos",
  "pieces": { "p": { "model": "pawn.glb" }, "r": { "model": "rook.glb" }, "…": "…" },
  "clips":  { "idle": "idle", "walk": "walk", "attack": "attack", "die": "die", "win": "win" },
  "colors": { "w": "#e8dfc8", "b": "#3a3531" },
  "scale": 1.0,
  "board":  { "light": "#d8c79e", "dark": "#6e4a2f", "frame": "#3b2b1d" }
}
```

Reglas del formato:
- 6 modelos **GLB** (un solo modelo por pieza; el color de cada bando se tiñe al
  instanciar con `colors`). Convención de orientación: el modelo mira hacia **+z**.
- `clips` mapea los clips canónicos del juego (`idle`, `walk`, `attack`, `die`,
  `win`) a los nombres de clip dentro del GLB. Todos son opcionales: si falta
  uno, el juego usa un movimiento/fundido equivalente (así funciona el set
  "Clásico", que no trae ninguno).
- `board` define los colores del tablero del set (el entorno completo como
  modelo 3D llegará en un hito posterior).
- El catálogo de sets disponibles está en `client/public/sets/index.json`.

El set de referencia "Guerreros Geométricos" se genera con
`npm run generate:set --workspace=client` (esqueleto root → spine → head + armR
con espada, ligado rígido por vértice). Cualquier set externo entra igual:
exportar GLB con esqueleto + clips desde Blender/Mixamo/Meshy y escribir su
`set.json`.

El set "Clásico" es procedural (sin GLBs); para editarlo en Blender,
`npm run export:classic --workspace=client` lo exporta a GLBs + `set.json` y
deja un ZIP listo para subir desde `/admin.html` (detalles en el manual).

Para instalar un set sin tocar el repositorio: empaquetar `set.json` + los
`.glb` en un ZIP (sin subcarpetas) y subirlo desde la página de administración
(`/admin.html`). Queda en `server/data/sets/` y se sirve bajo `/usersets/`.

Opciones para crear los assets (si no se modelan a mano en Blender):

- **Assets ya hechos y animables**: Sketchfab (filtrar por *rigged* + licencia CC),
  Unity Asset Store / Fab (Unreal) — muchos packs exportan a FBX→GLB,
  Quaternius y Kenney (low-poly gratuitos, algunos riggeados).
- **Generación por IA**: Meshy.ai y Tripo3D (texto/imagen → modelo 3D con rigging
  automático y animaciones básicas), Luma Genie. Después se refinan en Blender.
- **Rigging/animación automática**: Mixamo (auto-rig de humanoides + biblioteca
  enorme de animaciones de combate, gratis) — ideal para piezas humanoides;
  Cascadeur para animación física asistida.
