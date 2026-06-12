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
npm run dev        # web (vite, :5173 con proxy /api) + api (fastify, :3001)
npm run build      # build de producción (client/dist + server/dist)
npm start          # producción: el servidor sirve client/dist y la API

# Pruebas de humo (requiere build previo y Chrome):
npm run test:smoke --workspace=client
```

### Variables de entorno del servidor

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | Puerto/host de escucha (3001 / 127.0.0.1) |
| `ADB_DB` | Ruta del SQLite (por defecto `server/data/adb.sqlite`) |
| `BASE_URL` | URL pública para los enlaces de los correos |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Envío real de correo; sin `SMTP_HOST`, los correos se vuelcan a consola |
| `ADB_DEV=1` | Endpoints de desarrollo (`/api/dev/mails`, lo usan las pruebas) |

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
- [ ] **Hito 5 — Juego en línea**: persona contra persona vía WebSockets, el servidor
  como árbitro (valida jugadas con la misma lógica chess.js).
- [ ] **Hito 6 — IAs LLM**: jugadores LLM configurables (Qwen, DeepSeek, Claude, etc.)
  vía API, modo LLM contra LLM, prompts con FEN + historial y validación de jugadas
  ilegales con reintento.
- [ ] **Hito 7 — Administración**: panel admin para API keys, configurar IAs
  disponibles y subir nuevos sets de assets.

## Pipeline de assets 3D (hito 2)

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

Opciones para crear los assets (si no se modelan a mano en Blender):

- **Assets ya hechos y animables**: Sketchfab (filtrar por *rigged* + licencia CC),
  Unity Asset Store / Fab (Unreal) — muchos packs exportan a FBX→GLB,
  Quaternius y Kenney (low-poly gratuitos, algunos riggeados).
- **Generación por IA**: Meshy.ai y Tripo3D (texto/imagen → modelo 3D con rigging
  automático y animaciones básicas), Luma Genie. Después se refinan en Blender.
- **Rigging/animación automática**: Mixamo (auto-rig de humanoides + biblioteca
  enorme de animaciones de combate, gratis) — ideal para piezas humanoides;
  Cascadeur para animación física asistida.
