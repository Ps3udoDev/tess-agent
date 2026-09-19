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
| `AssistantStreamEvent` (5 eventos)           | ya tipado     | F2 lo produce, F3 emite `assistant.source` | no lo toca |
| `tess-client` (HTTP/SSE)                     | F2            | F3, F4                        | stub; solo el atributo `api-url`  |
| Esquema Supabase (12 tablas)                 | ya migrado    | F2, F3, F4                    | no lo toca                        |
| Allowlist de herramientas MCP                | F4            | F5                            | fuera de alcance                  |

#### `AssistantStreamEvent` no se renegocia en ninguna fase

La versión anterior de esta tabla decía que F3 "añade" `assistant.source`, lo
cual contradecía la premisa de que un contrato congelado no se renegocia.

La contradicción era del documento, no del código:
`packages/tess-types/src/events.ts` **ya declara los cinco eventos, incluido
`assistant.source`**. Ninguna fase añade variantes. F2 implementa el productor
y emite los cuatro primeros; F3 empieza a emitir `assistant.source` cuando hay
RAG que citar. El tipo no cambia.

Se conserva la forma `{ event, data }` que ya está en el repo, en vez de
aplanarla a `{ type, ...campos }`. Refleja el formato de cable de SSE —líneas
`event:` y `data:`—, así que el parser mapea uno a uno sin traducción
intermedia.

#### Punto de inyección del cliente, congelado en F1

Decir "en F2 se lo pasa a `tess-client`" dejaba abierto *cómo*, y eso obligaría
a reestructurar el web component en F2. Se congela ahora la costura:

```ts
// en tess-types: la interfaz que F2 debe satisfacer, definida ya en F1
export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
}

// en tess-client: lo único que F1 implementa
export function createNoopTessClient(): TessClientLike;
```

El web component expone `setClient(client: TessClientLike): void` y, si nadie
inyecta uno, usa el noop. `api-url` y `project-id` se guardan en una
`TessAssistantConfig` interna que el componente pasará al factory del cliente
real.

Resultado: en F2 cambia **solo la implementación** de `createTessClient`. La
API pública del web component —atributos, métodos y eventos— no se toca.

### Puertas de salida por fase

**F1 · Componente visual.** `tess-core`, `tess-rive`, `tess-web-component`,
`tess-svelte` y la demo con panel de pruebas.

> Gate, en tres bloques.
>
> **Automático:** `pnpm build && pnpm test && pnpm typecheck && pnpm lint` en
> verde. `npm pack` (o `pnpm pack`) produce tarball válido para los cuatro
> paquetes publicables y `publint` no reporta errores de exports. El bundle
> `tess.global.js` **no contiene Svelte** —el web component es vanilla; si
> Svelte aparece en el grafo, es una fuga del wrapper— ni URLs de backend ni
> secretos. Los tests de `destroy()` verifican que se llamó `rive.cleanup()`,
> que ambos observers quedaron desconectados y que la suscripción al core fue
> cancelada.
>
> **Integración:** una demo limpia que instala el paquete **construido** (no el
> workspace) monta el componente y funciona. El fallback CSS aparece cuando se
> apunta `src` a un `.riv` inexistente.
>
> **Manual, en la demo:** los siete estados sobre el avatar real; el botón
> destroy/remount sin fugas; con `prefers-reduced-motion` activo el avatar
> queda estático; launcher y diálogo recorribles **solo con teclado**
> —Tab hasta el launcher, Enter para abrir, Escape para cerrar, y el foco
> vuelve al launcher—; y la **QA visual de los transitorios**: `success` y
> `error` deben terminar su animación justo cuando el estado lógico vuelve a
> `idle`. Si se desincronizan, se ajusta `transientMs`, no el `.riv`.

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
/** `offline` es derivado de la conectividad: el integrador no puede pedirlo. */
export type RequestedState = Exclude<AssistantState, 'offline'>;

export interface TessSnapshot {
  state: AssistantState; // estado efectivo, lo que se pinta
  requested: RequestedState; // lo que pidió el integrador
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
`transientMs`, configurable:

```ts
createTessCore({ transientMs: { success: 1920, error: 2520 } });
```

Los defaults **no son estimaciones**: salen de medir `tess-rive/scene.rml`.

| Animación      | Frames @60fps | Duración | Blend de salida | Total    |
| -------------- | ------------- | -------- | --------------- | -------- |
| `anim_success` | 108           | 1800 ms  | 120 ms          | 1920 ms  |
| `anim_error`   | 144           | 2400 ms  | 120 ms          | 2520 ms  |

Los valores provisionales anteriores —1600 y 2400 ms— eran **ambos
demasiado cortos**: el estado lógico habría vuelto a `idle` con la animación
aún corriendo, 320 ms antes en `success` y 120 ms antes en `error`.

**Duración lógica y duración visual son cosas distintas, y el `.riv` ya
resuelve la visual.** Los estados `success` y `error` de `TessStateMachine`
llevan una transición incondicional a `idle` con `enableExitTime="true"`,
`exitTime="100"` y `duration="120"`. Es decir, el avatar vuelve solo a idle
al terminar la animación, sin que nadie se lo pida.

El temporizador de `tess-core` no conduce el retorno visual: gobierna el
**estado lógico**, el que se reporta en `tess:state` y el que ve el
integrador. Los defaults se eligen para que ambos coincidan; si se
desincronizan, es el lógico el que se ajusta.

**Cancelación.** Cualquier `setState` posterior cancela el temporizador
pendiente. Los casos que los tests deben cubrir explícitamente:

- `success → thinking` antes de que venza: gana `thinking`, y el temporizador
  viejo **no** puede devolver a `idle` después.
- `error → idle` manual: cancela sin efectos posteriores.
- `success → offline → online`: al reconectar se restaura `success` solo si el
  temporizador aún no había vencido; si venció durante el corte, se restaura
  `idle`.
- `destroy()` con temporizador pendiente: se cancela y no notifica a nadie.

**Offline como override derivado.** Al perder red, `state` pasa a `'offline'`
mientras `requested` conserva lo que pidió el integrador. Al volver la red se
restaura `requested`. Los dos campos del snapshot existen por esto: con uno
solo se perdería el estado en curso.

**Reduced-motion.** Vía `matchMedia('(prefers-reduced-motion: reduce)')` con
listener. No es un estado sino una señal paralela, porque el `.riv` la expone
como booleano independiente que convive con los demás.

`tess-core` solo propaga la señal; no tiene que suprimir nada. La state machine
ya trata `prefers_reduced_motion` como override duro: **todos** los estados
tienen una transición a `anim_reduced_motion` —una pose estática de un solo
frame— con `duration="0"` en cuanto el booleano pasa a `true`, y vuelven a
`idle` cuando pasa a `false`.

**Después de `destroy()` el core queda inerte:** ignora `setState`, no notifica
a ningún suscriptor, cancela el temporizador pendiente y desengancha los
listeners de `matchMedia` y de conectividad. `getSnapshot()` sigue devolviendo
el último snapshot conocido. Llamar `destroy()` dos veces no tiene efecto
adicional.

`setState` con un valor fuera de `RequestedState` —`'offline'` incluido— se
ignora en runtime y se registra por `onError`, ya que TypeScript solo protege
a quien compila.

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
  fuerzan. **Afecta solo al chrome CSS del componente** —launcher, diálogo,
  bordes, fondo y texto—. El avatar conserva su paleta propia: `TessStateMachine`
  declara exactamente tres triggers y cuatro booleanos, ninguno de color ni
  numérico, así que no hay forma de retintar el artboard desde fuera. Si en el
  futuro se añaden inputs de color al `.riv`, este atributo podrá extenderse
  sin romper la API.
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
