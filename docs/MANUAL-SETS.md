# Manual: crear y editar sets de piezas

Este manual explica cómo editar los sets existentes y cómo crear sets nuevos
para Ajedrez de Batalla — desde retocar un GLB en Blender hasta empaquetar y
subir un set completo sin tocar el código.

## Cómo funciona un set

Un **set de piezas** es una carpeta con un manifiesto `set.json` y los modelos
3D en formato **GLB** (glTF binario). El juego carga los modelos, les aplica
los clips de animación que declares y los instancia para ambos bandos.

```
mi-set/
├── set.json
├── pawn.glb
├── rook.glb
├── knight.glb
├── bishop.glb
├── queen.glb
└── king.glb
```

### set.json de referencia

```json
{
  "format": 1,
  "id": "mi-set",
  "name": "Mi Set Épico",
  "pieces": {
    "p": { "model": "pawn.glb" },
    "r": { "model": "rook.glb" },
    "n": { "model": "knight.glb" },
    "b": { "model": "bishop.glb" },
    "q": { "model": "queen.glb" },
    "k": { "model": "king.glb" }
  },
  "clips": { "idle": "idle", "walk": "walk", "attack": "attack", "die": "die", "win": "win" },
  "colors": { "w": "#e8dfc8", "b": "#3a3531" },
  "scale": 1.0,
  "board": { "light": "#d8c79e", "dark": "#6e4a2f", "frame": "#3b2b1d" }
}
```

| Campo | Significado |
|---|---|
| `id` | Identificador único: minúsculas, números y guiones (2–30 caracteres) |
| `pieces` | Un modelo por tipo de pieza: `p`eón, `r`(torre), k`n`ight (caballo), `b`(alfil), `q`(dama), `k`(rey) |
| `clips` | Mapeo de los clips canónicos del juego a los nombres de las animaciones dentro de tus GLB. **Todos opcionales**: si falta uno, el juego usa un movimiento equivalente |
| `colors` | Color de cada bando. El juego **sustituye los materiales** del GLB por este color plano |
| `scale` | Factor de escala global del set |
| `board` | Colores del tablero (se aplican sobre la madera veteada) |

### Dos maneras de colorear los bandos

1. **Un modelo por pieza + `colors`** (`"model"`): el juego reemplaza todos los
   materiales del GLB por un color plano por bando. Es lo más simple, pero
   **se pierden los materiales y texturas** del modelo.

2. **Un modelo por color** (`"modelW"` / `"modelB"`): el juego usa cada GLB
   tal cual, **conservando sus materiales y texturas**. Ideal para sets
   artísticos:

```json
"pieces": {
  "p": { "modelW": "pawn_blanco.glb", "modelB": "pawn_negro.glb" },
  "…": "…"
}
```

Puedes mezclar: unas piezas con `model` y otras con `modelW`/`modelB`.

### Convenciones de los modelos

- **Escala**: una casilla mide 1×1 unidades. Un peón ronda 0.6–0.7 de alto y
  un rey 1.0–1.1. Si tu modelo viene en otra escala, ajusta con `scale`.
- **Origen**: en el centro de la base de la pieza (la pieza "pisa" en y=0).
- **Orientación**: la pieza mira hacia **+Z**. El juego rota cada bando para
  encarar a su rival.
- **Animaciones**: clips con nombre dentro del GLB. Los canónicos son:
  - `idle` (bucle) — reposo
  - `walk` (bucle) — desplazamiento
  - `attack` (una vez) — golpe al capturar
  - `die` (una vez) — muerte; la pose final se mantiene mientras la pieza se hunde
  - `win` (una vez) — celebración (se usa al coronar un peón)
- Cualquier esqueleto sirve (no hay nombres de huesos obligatorios); el juego
  solo reproduce los clips por nombre con un AnimationMixer.

## Editar las piezas existentes en Blender

> ⚠️ **Los GLB no se abren con `File > Open`** (ese diálogo solo entiende
> archivos `.blend`; el `.glb` ni siquiera aparece o se ignora). Hay que
> **importarlos**: `File > Import > glTF 2.0 (.glb/.gltf)`. Está disponible
> de serie en Blender 2.8+ sin instalar nada.

1. Descarga el GLB que quieras retocar (p. ej.
   `client/public/sets/guerreros/pawn.glb`).
2. En Blender: `File > Import > glTF 2.0` y elige el archivo. Verás la malla,
   el esqueleto (Armature con huesos `root`, `spine`, `head`, `armR` en el set
   guerreros) y, en el editor de animaciones (Dope Sheet → Action Editor), las
   acciones `idle`, `walk`, `attack`, `die`, `win`.
3. Edita la malla, los pesos o las animaciones a tu gusto. Si añades clips
   nuevos, dales nombre en el Action Editor y márcalos con **Push Down /
   Stash** (guardarlos en el NLA) para que se exporten.
4. Exporta: `File > Export > glTF 2.0` con estos ajustes:
   - **Format**: `glTF Binary (.glb)`
   - **Include > Data**: activa `Animation` (Animation mode: *Actions*)
   - Deja `+Y Up` activado (es el estándar glTF que usa el juego)
5. Sustituye el `.glb` en la carpeta del set (o crea un set nuevo, abajo).

> 💡 El set "Guerreros Geométricos" también puede regenerarse por código:
> `npm run generate:set --workspace=client` (edita
> `client/scripts/generate-set.mjs`). Si solo quieres ajustar proporciones o
> animaciones de ese set, suele ser más cómodo tocar el script que Blender.

### Editar el set "Clásico" en Blender

El set "Clásico (sin animación)" no tiene archivos GLB: sus piezas Staunton se
generan por código al cargar el juego (`client/src/sets/classic.ts`, perfiles
de revolución + detalles). Hay dos maneras de editarlo:

- **Por código**: ajustar los perfiles `[radio, altura]` y las formas en
  `classic.ts` (cómodo para proporciones y grosores).
- **En Blender**: exportarlo primero a GLBs con

  ```bash
  npm run export:classic --workspace=client
  ```

  Eso crea `client/scripts/export/clasico-editable/` (6 GLBs + `set.json`) y
  un `clasico-editable.zip` listo para subir tal cual desde `/admin.html`.
  Importa los GLB en Blender (`File > Import > glTF 2.0`), esculpe a gusto,
  re-exporta con el mismo nombre y vuelve a comprimir el ZIP (archivos en la
  raíz, sin subcarpeta). Estos GLB no llevan esqueleto ni animaciones: el
  juego usa sus movimientos de reserva, igual que con el Clásico integrado.

## Crear un set desde cero

### Opción A: modelar y animar en Blender

1. Modela las 6 piezas (o ármalas con assets CC de Sketchfab/Quaternius/Kenney).
2. Riggea cada pieza (Armature) y crea las acciones `idle`, `walk`, `attack`,
   `die` (y `win` si quieres).
3. Exporta cada pieza como GLB (ajustes de arriba) con el origen en la base.
4. Escribe el `set.json` y empaqueta (ver "Instalar el set").

### Opción B: generación por IA + auto-rigging

- **Meshy.ai / Tripo3D**: generan el modelo 3D desde texto o imagen, con
  rigging y animaciones básicas; exporta FBX o GLB.
- **Mixamo** (gratis, de Adobe): sube un modelo humanoide, lo auto-riggea y le
  aplicas animaciones de su biblioteca (hay cientos de ataques, muertes,
  caminatas e idles). Descarga FBX → impórtalo en Blender → renombra las
  acciones a los nombres canónicos → exporta GLB.

  Truco Mixamo: descarga cada animación "without skin" salvo la primera, e
  impórtalas sobre el mismo esqueleto en Blender; cada FBX llega como una
  acción que puedes renombrar (`idle`, `walk`…) y guardar en el NLA.

### Opción C: sin animaciones

Un set puede no traer clips (deja `"clips": {}`): las piezas se deslizan y las
capturas usan fundidos. Perfecto para sets "de museo" (piezas talladas
estáticas con buenos materiales + `modelW`/`modelB`).

## Instalar el set

**Sin tocar el repositorio** (recomendado): empaqueta `set.json` + los `.glb`
en un **ZIP plano** (sin subcarpetas) y súbelo desde la página de
administración del juego (`/admin.html`, sección "Sets de piezas"). El set
aparece al instante en el selector y queda guardado en `server/data/sets/`.

**En el repositorio** (sets "de fábrica"): crea la carpeta en
`client/public/sets/<id>/` y añade la entrada en
`client/public/sets/index.json`.

## Solución de problemas

| Problema | Causa y solución |
|---|---|
| "No puedo abrir el GLB en Blender" | Usa `File > Import > glTF 2.0`, no `File > Open` |
| La pieza sale de lado o de espaldas | El modelo no mira a +Z: rota la malla (no el objeto) o aplica la rotación (`Ctrl+A > Rotation`) antes de exportar |
| La pieza flota o se entierra | El origen no está en la base: en Blender, `Object > Set Origin` y coloca la pieza con los pies en y=0 |
| Tamaño desproporcionado | Ajusta `scale` en set.json (la casilla mide 1×1) |
| Las animaciones no se exportan | Las acciones deben estar guardadas (Push Down/Stash en el NLA) y `Animation` activado al exportar |
| El clip no se reproduce en el juego | El nombre en `clips` debe coincidir exactamente con el nombre de la acción dentro del GLB |
| Las texturas no se ven en el juego | Con `"model"` el juego sustituye materiales por `colors`. Usa `modelW`/`modelB` para conservar materiales y texturas |
| El ZIP es rechazado al subirlo | Debe ser plano (set.json en la raíz del ZIP), con `id` válido y todos los `.glb` que declara `pieces` |
