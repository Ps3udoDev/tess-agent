# Fase 1 — Componente visual

Fecha: 2026-09-19
Estado: aprobado, pendiente de plan de implementación

## Contexto

El monorepo está andamiado pero vacío: 937 líneas de fuente, casi todo
boilerplate, con marcadores `TODO(fase-1)` en los cuatro paquetes que esta fase
debe construir.

Lo único terminado es el artefacto Rive. `tess-rive/build/tess.riv` existe,
tiene QA capturada para los siete estados más los tamaños 48, 96, 128 y 256, y
su contrato ya está extraído en `packages/tess-rive/src/contract.ts`: artboard
`Tess`, máquina `TessStateMachine`, tres triggers (`trigger_greet`,
`trigger_success`, `trigger_error`) y cuatro booleanos (`is_listening`,
`is_thinking`, `is_speaking`, `prefers_reduced_motion`).

Las doce tablas de Supabase ya están migradas y sembradas en local. Fase 1 no
las toca.

## Decisión central

`tess-core` es un **store observable con estados transitorios**, no una máquina
de estados con guardas de transición.

El motivo es la Fase 2: el estado lo dictará el servidor vía el evento SSE
`assistant.state`. Unas guardas de transición en el cliente acabarían
peleándose con el servidor y terminarían desactivadas. El store acepta
cualquier `AssistantState` venga de donde venga, y se reserva únicamente la
lógica que es genuinamente local.

Alternativas descartadas:

- **FSM estricta en `tess-core`.** Diseña hoy una restricción que estorba en
  Fase 2.
- **Toda la lógica en el web component.** Dejaría `tess-core` —que es un
  paquete npm publicable y lo que `tess-client` necesita en Fase 2— sin
  contenido, y al wrapper React del scaffold sin núcleo del que colgarse.

## Mapa de fases y contratos

Lo que impide que una fase interfiera con la siguiente no es el orden, son las
fronteras. Cada fase congela un contrato que las posteriores consumen sin
renegociar.

| Contrato                                     | Se congela en | Lo consume                    | Fase 1                            |
| -------------------------------------------- | ------------- | ----------------------------- | --------------------------------- |
| `AssistantState` (7 estados)                 | F1            | F2 vía SSE, F4                | lo implementa                     |
| `<teams4soft-assistant>` atributos y eventos | F1            | todas                         | lo implementa                     |
| `AssistantStreamEvent` (5 eventos)           | F2            | F3 añade `assistant.source`   | no lo toca, ya está tipado        |
| `tess-client` (HTTP/SSE)                     | F2            | F3, F4                        | stub; solo el atributo `api-url`  |
| Esquema Supabase (12 tablas)                 | ya migrado    | F2, F3, F4                    | no lo toca                        |
| Allowlist de herramientas MCP                | F4            | F5                            | fuera de alcance                  |

La costura clave es `api-url`: en Fase 1 el web component lo acepta y lo guarda
sin usarlo. En Fase 2 se lo pasa a `tess-client`. Ningún archivo de Fase 1
cambia por ello.

### Puertas de salida por fase

**F1 · Componente visual.** `tess-core`, `tess-rive`, `tess-web-component`,
`tess-svelte` y la demo con panel de pruebas.

> Gate: `pnpm build && pnpm test && pnpm typecheck && pnpm lint` en verde; la
> demo muestra los siete estados sobre el avatar real; los tests de `destroy()`
> verifican que se llamó `rive.cleanup()`, que ambos observers quedaron
> desconectados y que la suscripción al core fue cancelada, y el botón
> destroy/remount de la demo lo confirma a mano; con `prefers-reduced-motion`
> activo el avatar no anima.

**F2 · Backend de chat.** `services/api` en Fastify con auth Supabase, RLS por
tenant, CRUD de conversaciones y mensajes, y endpoint SSE con respuestas
simuladas. `tess-client` implementado.

> Gate: `curl` al SSE devuelve la secuencia `state → delta* → completed`; un
> usuario de la organización A no ve conversaciones de la B; la demo conversa
> contra el API local.

**F3 · RAG.** Storage, extracción, chunking, embeddings vía AI Gateway,
`pgvector` con filtro por tenant y citas. Ingestión en `ingest-worker`, fuera
de la petición interactiva.

> Gate: se sube un PDF, el worker lo procesa, y una pregunta devuelve respuesta
> con `assistant.source` apuntando al documento correcto; la búsqueda vectorial
> nunca cruza tenants.

**F4 · Agente y conectores.** Herramientas con allowlist, `mcp-gateway`,
adaptadores MSP en `connector-worker`, timeouts, rate limits y `audit_events`
poblado.

> Gate: una herramienta fuera de allowlist se rechaza y queda auditada; un
> timeout corta sin colgar el stream; tests de permisos por rol en verde.

**F5 · Operación.** Docker, Cloud Run, CI/CD, Sentry con releases y source
maps, OpenTelemetry, p50/p95, pruebas de carga, threat model y scrubbing de
PII.

> Gate: un error en producción aparece en Sentry con source map resuelto y
> traza correlacionada UI↔API; p95 dentro de objetivo bajo carga; no aparece
> PII en logs.

## Arquitectura de Fase 1

```text
atributo state ─→ tess-core ─→ tess-rive ─→ inputs del .riv ─→ avatar
                      │
                      └──────→ tess-web-component ─→ evento tess:state
```

`tess-core` es la única fuente de verdad. `tess-rive` y el web component son
suscriptores. El estado no se escribe en dos sitios.

### `tess-core`

```ts
export interface TessSnapshot {
  state: AssistantState; // estado efectivo, lo que se pinta
  requested: AssistantState; // lo que pidió el integrador
  reducedMotion: boolean;
  online: boolean;
}

export interface TessCore {
  getSnapshot(): TessSnapshot;
  setState(next: AssistantState): void;
  subscribe(fn: (s: TessSnapshot) => void): () => void;
  destroy(): void;
}

export function createTessCore(options?: TessCoreOptions): TessCore;
```

Tres comportamientos, y solo estos tres:

**Estados transitorios.** `setState('success')` vuelve solo a `idle` tras
`transientMs`; por defecto 1600 ms para `success` y 2400 ms para `error`. Si
llega otro `setState` antes, el temporizador se cancela. Es la semántica de
trigger del `.riv` expresada una sola vez, en el único sitio que la conoce.

**Offline como override derivado.** Al perder red, `state` pasa a `'offline'`
mientras `requested` conserva lo que pidió el integrador. Al volver la red se
restaura `requested`. Los dos campos del snapshot existen por esto: con uno
solo se perdería el estado en curso.

**Reduced-motion.** Vía `matchMedia('(prefers-reduced-motion: reduce)')` con
listener. No es un estado sino una señal paralela, porque el `.riv` la expone
como booleano independiente que convive con los demás.

`TessCoreOptions` inyecta `media` y `online` para poder testear sin navegador.
Su única dependencia es `@teams4soft/tess-types`, de la que consume el
vocabulario `ASSISTANT_STATES`. No toca el DOM ni el canvas, así que se prueba
en Node puro.

### `tess-rive`

```ts
export function mountTessRive(opts: {
  canvas: HTMLCanvasElement;
  core: TessCore;
  src?: string; // defecto: el asset empaquetado
  onError?: (e: Error) => void;
}): TessRiveHandle;

export interface TessRiveHandle {
  greet(): void;
  destroy(): void;
}
```

Traducción de estado a inputs:

| `AssistantState`                     | Efecto en el `.riv`                                 |
| ------------------------------------ | --------------------------------------------------- |
| `listening` / `thinking` / `speaking` | su booleano a `true`, los otros dos a `false`        |
| `success` / `error`                  | dispara el trigger **al entrar** en el estado        |
| `idle` / `offline`                   | los tres booleanos a `false`                         |
| señal `reducedMotion`                | `prefers_reduced_motion`                             |

El matiz de "al entrar" es necesario: el suscriptor compara con el snapshot
anterior y dispara solo en la transición. Sin eso, cualquier cambio de
`reducedMotion` relanzaría la animación de éxito.

**`trigger_greet`** no tiene `AssistantState` correspondiente porque es
decorativo, no un estado del asistente. Se expone como método imperativo en el
handle en lugar de inventarle un estado o montar un bus de eventos que esta
fase no necesita. El web component lo dispara al abrir el chat, que es cuándo
tiene sentido saludar.

**Ciclo de vida.** `IntersectionObserver` pausa el runtime fuera de viewport.
`ResizeObserver` más `devicePixelRatio` mantienen el canvas nítido. `destroy()`
llama `rive.cleanup()`, desconecta ambos observers y cancela la suscripción al
core.

**Fallo de carga.** Si el `.riv` no carga, se llama `onError` y el web
component pinta un avatar estático en CSS. Un fallo de CDN no puede dejar un
botón en blanco.

### `tess-web-component`

```html
<teams4soft-assistant
  state="idle"
  theme="auto|light|dark"
  size="48|96|128|256"
  position="bottom-right|bottom-left|top-right|top-left"
  api-url="…"
  locale="es|en"
  open
></teams4soft-assistant>
```

- Métodos: `openChat()`, `closeChat()`, `destroy()`
- Eventos: `tess:open`, `tess:close`, `tess:state` con `{state}`, `tess:error`
  con `{code, message}`
- `api-url` se guarda pero no se usa en esta fase.

Semántica de los atributos, para que no queden a interpretación:

- `theme="auto"` resuelve contra `prefers-color-scheme`; `light` y `dark` lo
  fuerzan.
- `size` es un enum cerrado de los cuatro valores con QA capturada, no un
  número libre de píxeles. Un valor fuera del enum cae al defecto `96` y emite
  `tess:error`.
- `locale` en esta fase solo selecciona las cadenas de `aria-label` del
  launcher y del diálogo, porque no hay más texto que traducir todavía.

Shadow DOM **abierto**, con `part="launcher"` y `part="dialog"` para que el
integrador pueda re-estilar sin que se expongan internals. El launcher es un
`<button>` real con `aria-haspopup="dialog"`, `aria-expanded` y
`aria-controls`.

**Forma:** launcher flotante que se ancla solo, con `position` configurable y
`bottom-right` por defecto. Una línea de HTML y funciona.

#### Diálogo: `<dialog>` no modal

Se usa `<dialog>` con `show()`, no `showModal()`.

`showModal()` daría gratis Escape, trampa de foco, fondo `inert` y top-layer,
pero bloquea la página. Consultar algo _sobre la página que estás viendo_ es el
caso de uso entero de un asistente de soporte, así que se acepta el coste de
implementar a mano:

- cierre con Escape,
- foco al primer elemento interactivo al abrir,
- devolución del foco al launcher al cerrar,
- gestión explícita de `z-index`, ya que `show()` no promueve al top-layer.

**El diálogo se abre vacío.** Sin lista de mensajes, sin input, sin burbujas.
Esa UI llega en Fase 2, cuando se conozca la forma real del stream SSE.

### `tess-svelte` y `tess-types`

`tess-svelte` gana `src/Tess.svelte` —props a atributos, eventos reenviados— y
migra su build a `@sveltejs/package`, porque tsup no compila `.svelte` para
distribución.

`tess-types` gana solo los tipos de `detail` de los eventos, para que web
component y wrappers compartan vocabulario.

### Demo

`apps/demo-svelte` recibe un panel de pruebas: botonera con los siete estados,
selects de theme, size y position, toggle de reduced-motion, botón
destroy/remount y un log de eventos en vivo. Es a la vez la superficie de
validación y el entregable de la fase.

## Testing

| Paquete               | Entorno                          | Qué se prueba                                                                                       |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `tess-core`           | node                             | transitorios con fake timers, override offline y restauración, reduced-motion, unsubscribe, destroy  |
| `tess-rive`           | jsdom + mock de `@rive-app/canvas` | booleanos correctos por estado, trigger solo en transición, destroy limpia observers y suscripción   |
| `tess-web-component`  | jsdom                            | registro del elemento, reflexión de atributos, eventos, atributos ARIA, destroy                      |

Límite conocido: que el avatar _se vea bien_ no lo cubre ningún test unitario.
El renderizado real se valida en la demo, a ojo. Los tests cubren lógica y
cableado, no píxeles.

`tess-rive` necesita jsdom pese a que el runtime de Rive va mockeado, porque
el módulo usa `HTMLCanvasElement`, `IntersectionObserver` y `ResizeObserver`.
Los dos observers se stubean en el setup del test.

Añadidos al catálogo de `pnpm-workspace.yaml`: `jsdom` y `@sveltejs/package`.

## Fuera de alcance

Fase 1 no hace red, ni auth, ni mensajes, ni deploy. El diálogo se abre y se
cierra vacío. `tess-client` sigue siendo el stub actual. El esquema de Supabase
no se toca. Esto es lo que mantiene la fase acotada y su gate verificable sin
backend.
