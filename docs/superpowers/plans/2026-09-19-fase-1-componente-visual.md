# Fase 1 — Componente visual: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** construir el avatar Tess como Web Component distribuible —`tess-core`, `tess-rive`, `tess-web-component`, `tess-svelte`— con una demo que permita validar los siete estados sobre el artefacto Rive real.

**Architecture:** `tess-core` es un store observable con estados transitorios y la única fuente de verdad. `tess-rive` y `tess-web-component` son suscriptores: el primero traduce estado a inputs de `TessStateMachine`, el segundo compone el DOM accesible. Nada de red en esta fase; el punto de inyección del cliente queda congelado tras una interfaz con implementación noop.

**Tech Stack:** TypeScript 6, tsup (ESM + bundle IIFE), vitest, `@rive-app/canvas` 2.42, Svelte 5, SvelteKit 2, pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-19-fase-1-componente-visual-design.md`

## Global Constraints

- Node `>=22.0.0`, pnpm `>=11.0.0`, `packageManager: pnpm@11.15.0`.
- Todos los paquetes son ESM puro (`"type": "module"`), target `es2023`.
- Los imports relativos entre archivos del mismo paquete llevan extensión `.js` (NodeNext).
- Las versiones de dependencias externas se referencian como `catalog:`, nunca literales. Añadir al catálogo de `pnpm-workspace.yaml` si falta.
- Las dependencias entre paquetes del monorepo se referencian como `workspace:*`.
- `AssistantState` tiene exactamente siete valores: `idle`, `listening`, `thinking`, `speaking`, `success`, `error`, `offline`.
- El contrato del `.riv` es inmutable en esta fase: artboard `Tess`, máquina `TessStateMachine`, triggers `trigger_greet` / `trigger_success` / `trigger_error`, booleanos `is_listening` / `is_thinking` / `is_speaking` / `prefers_reduced_motion`.
- Defaults de transitorios: `success: 1920`, `error: 2520` (milisegundos).
- `tess-web-component` es vanilla: **no puede importar Svelte** ni nada que lo arrastre.
- Comentarios y documentación en español, igual que el resto del repo.
- Cada tarea termina con commit. Mensajes en español, prefijo Conventional Commits.

---

### Task 1: `tess-types` — vocabulario compartido

Define los tipos que todas las tareas posteriores consumen. Sin esto, nada compila.

**Files:**

- Create: `packages/tess-types/src/component.ts`
- Create: `packages/tess-types/src/client.ts`
- Create: `packages/tess-types/src/assistant.test.ts`
- Modify: `packages/tess-types/src/assistant.ts`
- Modify: `packages/tess-types/src/index.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `RequestedState`, `isRequestedState()`, `TessAssistantConfig`, `TessStateDetail`, `TessErrorDetail`, `SendMessageInput`, `TessClientLike`, `THEMES`, `SIZES`, `POSITIONS`, `DEFAULT_SIZE`, `DEFAULT_POSITION`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-types/src/assistant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ASSISTANT_STATES, isRequestedState } from './index.js';

describe('isRequestedState', () => {
  it('acepta los seis estados que el integrador puede pedir', () => {
    for (const state of ASSISTANT_STATES) {
      if (state === 'offline') continue;
      expect(isRequestedState(state)).toBe(true);
    }
  });

  it('rechaza offline porque es derivado de la conectividad', () => {
    expect(isRequestedState('offline')).toBe(false);
  });

  it('rechaza valores que no son del vocabulario', () => {
    expect(isRequestedState('thinking ')).toBe(false);
    expect(isRequestedState(42)).toBe(false);
    expect(isRequestedState(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-types test`
Expected: FAIL — `isRequestedState` no existe en `./index.js`.

- [ ] **Step 3: Añadir `RequestedState` y su guard**

Añadir al final de `packages/tess-types/src/assistant.ts`:

```ts
/**
 * Estados que el integrador puede solicitar.
 *
 * `offline` queda fuera a propósito: lo deriva `tess-core` de la
 * conectividad, no se pide desde fuera.
 */
export type RequestedState = Exclude<AssistantState, 'offline'>;

export function isRequestedState(value: unknown): value is RequestedState {
  return (
    typeof value === 'string' &&
    value !== 'offline' &&
    (ASSISTANT_STATES as readonly string[]).includes(value)
  );
}
```

- [ ] **Step 4: Crear los tipos del componente**

Crear `packages/tess-types/src/component.ts`:

```ts
import type { AssistantState } from './assistant.js';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type TessTheme = (typeof THEMES)[number];

/** Enum cerrado: son los cuatro tamaños con QA visual capturada. */
export const SIZES = [48, 96, 128, 256] as const;
export type TessSize = (typeof SIZES)[number];
export const DEFAULT_SIZE: TessSize = 96;

export const POSITIONS = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
] as const;
export type TessPosition = (typeof POSITIONS)[number];
export const DEFAULT_POSITION: TessPosition = 'bottom-right';

/** Configuración que el web component acumula y pasará al cliente en F2. */
export interface TessAssistantConfig {
  apiUrl?: string;
  projectId?: string;
  locale?: string;
}

export interface TessStateDetail {
  state: AssistantState;
}

export interface TessErrorDetail {
  code: string;
  message: string;
}
```

- [ ] **Step 5: Crear la interfaz del cliente (costura con F2)**

Crear `packages/tess-types/src/client.ts`:

```ts
import type { AssistantStreamEvent } from './events.js';

export interface SendMessageInput {
  conversationId: string;
  text: string;
  signal?: AbortSignal;
}

/**
 * Contrato que `tess-client` debe satisfacer en F2.
 *
 * Se define en F1 para que el web component dependa de esta interfaz y no de
 * una implementación. En F2 cambia el factory, no el componente.
 */
export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
}
```

- [ ] **Step 6: Reexportar desde el índice**

Añadir a `packages/tess-types/src/index.ts`:

```ts
export * from './client.js';
export * from './component.js';
```

- [ ] **Step 7: Ejecutar tests, typecheck y lint**

Run: `pnpm --filter @teams4soft/tess-types test && pnpm --filter @teams4soft/tess-types typecheck && pnpm --filter @teams4soft/tess-types lint`
Expected: PASS en los tres.

- [ ] **Step 8: Commit**

```bash
git add packages/tess-types
git commit -m "feat(types): añadir RequestedState, tipos del componente y TessClientLike"
```

---

### Task 2: `tess-core` — store observable

El núcleo sin transitorios ni conectividad todavía: crear, leer, cambiar, suscribir, destruir.

**Files:**

- Create: `packages/tess-core/src/core.ts`
- Create: `packages/tess-core/src/core.test.ts`
- Modify: `packages/tess-core/src/index.ts`

**Interfaces:**

- Consumes: `RequestedState`, `isRequestedState`, `AssistantState` de Task 1.
- Produces: `createTessCore(options?)`, `TessCore`, `TessSnapshot`, `TessCoreOptions`, `MediaQueryListLike`, `ConnectivityLike`, `DEFAULT_TRANSIENT_MS`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-core/src/core.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTessCore } from './core.js';

describe('createTessCore', () => {
  it('arranca en idle y online', () => {
    const core = createTessCore();
    expect(core.getSnapshot()).toEqual({
      state: 'idle',
      requested: 'idle',
      reducedMotion: false,
      online: true,
    });
  });

  it('respeta initialState', () => {
    const core = createTessCore({ initialState: 'thinking' });
    expect(core.getSnapshot().state).toBe('thinking');
  });

  it('notifica a los suscriptores en cada cambio', () => {
    const core = createTessCore();
    const seen = vi.fn();
    core.subscribe(seen);
    core.setState('listening');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].state).toBe('listening');
  });

  it('no notifica si el estado no cambia', () => {
    const core = createTessCore();
    const seen = vi.fn();
    core.subscribe(seen);
    core.setState('idle');
    expect(seen).not.toHaveBeenCalled();
  });

  it('deja de notificar tras cancelar la suscripción', () => {
    const core = createTessCore();
    const seen = vi.fn();
    const unsubscribe = core.subscribe(seen);
    unsubscribe();
    core.setState('speaking');
    expect(seen).not.toHaveBeenCalled();
  });

  it('ignora offline porque es derivado, y lo reporta', () => {
    const onError = vi.fn();
    const core = createTessCore({ onError });
    // @ts-expect-error offline no pertenece a RequestedState
    core.setState('offline');
    expect(core.getSnapshot().state).toBe('idle');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('queda inerte tras destroy', () => {
    const core = createTessCore();
    const seen = vi.fn();
    core.subscribe(seen);
    core.destroy();
    core.setState('thinking');
    expect(seen).not.toHaveBeenCalled();
    expect(core.getSnapshot().state).toBe('idle');
    expect(() => core.destroy()).not.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-core test`
Expected: FAIL — no existe `./core.js`.

- [ ] **Step 3: Implementar el store**

Crear `packages/tess-core/src/core.ts`:

```ts
import {
  isRequestedState,
  type AssistantState,
  type RequestedState,
} from '@teams4soft/tess-types';

export interface TessSnapshot {
  /** Estado efectivo: lo que se pinta. */
  state: AssistantState;
  /** Lo que pidió el integrador. Sobrevive a un corte de red. */
  requested: RequestedState;
  reducedMotion: boolean;
  online: boolean;
}

export interface MediaQueryListLike {
  matches: boolean;
  addEventListener(
    type: 'change',
    fn: (event: { matches: boolean }) => void,
  ): void;
  removeEventListener(
    type: 'change',
    fn: (event: { matches: boolean }) => void,
  ): void;
}

export interface ConnectivityLike {
  isOnline(): boolean;
  subscribe(fn: (online: boolean) => void): () => void;
}

export interface TessCoreOptions {
  initialState?: RequestedState;
  transientMs?: { success?: number; error?: number };
  media?: (query: string) => MediaQueryListLike | null;
  connectivity?: ConnectivityLike;
  onError?: (error: Error) => void;
}

export interface TessCore {
  getSnapshot(): TessSnapshot;
  setState(next: RequestedState): void;
  subscribe(fn: (snapshot: TessSnapshot) => void): () => void;
  destroy(): void;
}

/**
 * Medido sobre `tess-rive/scene.rml`: anim_success dura 108 frames y
 * anim_error 144, ambas a 60 fps, más 120 ms de blend de vuelta a idle.
 */
export const DEFAULT_TRANSIENT_MS = { success: 1920, error: 2520 } as const;

export function createTessCore(options: TessCoreOptions = {}): TessCore {
  const onError = options.onError ?? (() => {});

  let destroyed = false;
  let requested: RequestedState = options.initialState ?? 'idle';
  const reducedMotion = false;
  const online = true;

  const listeners = new Set<(snapshot: TessSnapshot) => void>();

  function getSnapshot(): TessSnapshot {
    return {
      state: online ? requested : 'offline',
      requested,
      reducedMotion,
      online,
    };
  }

  function emit(previous: TessSnapshot): void {
    const next = getSnapshot();
    if (
      next.state === previous.state &&
      next.reducedMotion === previous.reducedMotion &&
      next.online === previous.online
    ) {
      return;
    }
    for (const listener of listeners) listener(next);
  }

  function setState(next: RequestedState): void {
    if (destroyed) return;
    if (!isRequestedState(next)) {
      onError(new Error(`Estado no solicitable: ${String(next)}`));
      return;
    }
    const previous = getSnapshot();
    requested = next;
    emit(previous);
  }

  function subscribe(fn: (snapshot: TessSnapshot) => void): () => void {
    if (destroyed) return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    listeners.clear();
  }

  return { getSnapshot, setState, subscribe, destroy };
}
```

- [ ] **Step 4: Reexportar desde el índice**

Reemplazar el cuerpo de `packages/tess-core/src/index.ts` conservando su encabezado de módulo, y dejando `INITIAL_STATE` e `isAssistantState` como están:

```ts
export * from './core.js';
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @teams4soft/tess-core test`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tess-core
git commit -m "feat(core): store observable con snapshot, suscripción y destroy inerte"
```

---

### Task 3: `tess-core` — estados transitorios

`success` y `error` vuelven solos a `idle`. Es la pieza con más aristas: los temporizadores viejos no pueden pisar interacciones nuevas.

**Files:**

- Modify: `packages/tess-core/src/core.ts`
- Create: `packages/tess-core/src/transient.test.ts`

**Interfaces:**

- Consumes: `createTessCore`, `DEFAULT_TRANSIENT_MS` de Task 2.
- Produces: comportamiento transitorio; sin API nueva.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-core/src/transient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTessCore, DEFAULT_TRANSIENT_MS } from './core.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('estados transitorios', () => {
  it('success vuelve a idle tras el default de 1920 ms', () => {
    const core = createTessCore();
    core.setState('success');
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success - 1);
    expect(core.getSnapshot().state).toBe('success');
    vi.advanceTimersByTime(1);
    expect(core.getSnapshot().state).toBe('idle');
  });

  it('error usa su propio default de 2520 ms', () => {
    const core = createTessCore();
    core.setState('error');
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.error - 1);
    expect(core.getSnapshot().state).toBe('error');
    vi.advanceTimersByTime(1);
    expect(core.getSnapshot().state).toBe('idle');
  });

  it('acepta duraciones configuradas', () => {
    const core = createTessCore({ transientMs: { success: 50 } });
    core.setState('success');
    vi.advanceTimersByTime(50);
    expect(core.getSnapshot().state).toBe('idle');
  });

  it('un temporizador viejo no pisa una interacción nueva', () => {
    const core = createTessCore();
    core.setState('success');
    vi.advanceTimersByTime(100);
    core.setState('thinking');
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success);
    expect(core.getSnapshot().state).toBe('thinking');
  });

  it('un estado no transitorio no programa temporizador', () => {
    const core = createTessCore();
    core.setState('listening');
    vi.advanceTimersByTime(10_000);
    expect(core.getSnapshot().state).toBe('listening');
  });

  it('destroy cancela el temporizador pendiente', () => {
    const core = createTessCore();
    const seen = vi.fn();
    core.subscribe(seen);
    core.setState('success');
    seen.mockClear();
    core.destroy();
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success);
    expect(seen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-core test transient`
Expected: FAIL — `success` se queda en `success` para siempre.

- [ ] **Step 3: Implementar los transitorios**

En `packages/tess-core/src/core.ts`, añadir tras la declaración de `DEFAULT_TRANSIENT_MS`:

```ts
const TRANSIENT_STATES = ['success', 'error'] as const;
type TransientState = (typeof TRANSIENT_STATES)[number];

function isTransient(state: RequestedState): state is TransientState {
  return (TRANSIENT_STATES as readonly string[]).includes(state);
}
```

Dentro de `createTessCore`, añadir junto a las demás variables:

```ts
const transientMs = { ...DEFAULT_TRANSIENT_MS, ...options.transientMs };
let timer: ReturnType<typeof setTimeout> | undefined;

function clearTransient(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}
```

Reemplazar el cuerpo de `setState` por:

```ts
function setState(next: RequestedState): void {
  if (destroyed) return;
  if (!isRequestedState(next)) {
    onError(new Error(`Estado no solicitable: ${String(next)}`));
    return;
  }
  // Cualquier cambio invalida el retorno pendiente: un temporizador viejo
  // nunca puede pisar una interacción nueva.
  clearTransient();
  const previous = getSnapshot();
  requested = next;
  if (isTransient(next)) {
    timer = setTimeout(() => {
      timer = undefined;
      setState('idle');
    }, transientMs[next]);
  }
  emit(previous);
}
```

Añadir `clearTransient()` dentro de `destroy()`, antes de `listeners.clear()`.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `pnpm --filter @teams4soft/tess-core test`
Expected: PASS, 13 tests (7 de Task 2 + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/tess-core
git commit -m "feat(core): estados transitorios con cancelación al cambiar de estado"
```

---

### Task 4: `tess-core` — offline y reduced-motion

Las dos señales del entorno. `offline` es un override derivado; `reducedMotion` una señal paralela.

**Files:**

- Modify: `packages/tess-core/src/core.ts`
- Create: `packages/tess-core/src/environment.ts`
- Create: `packages/tess-core/src/environment.test.ts`

**Interfaces:**

- Consumes: todo lo de Tasks 2 y 3.
- Produces: `browserConnectivity()`, `browserMedia()`; `TessCoreOptions.media` y `.connectivity` operativas.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-core/src/environment.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTessCore, DEFAULT_TRANSIENT_MS } from './core.js';
import type { ConnectivityLike, MediaQueryListLike } from './core.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeConnectivity(initial = true) {
  let online = initial;
  const subscribers = new Set<(value: boolean) => void>();
  return {
    api: {
      isOnline: () => online,
      subscribe(fn: (value: boolean) => void) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
    } satisfies ConnectivityLike,
    set(value: boolean) {
      online = value;
      for (const fn of subscribers) fn(value);
    },
  };
}

function fakeMedia(initial = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql: MediaQueryListLike = {
    matches: initial,
    addEventListener: (_type, fn) => void listeners.add(fn),
    removeEventListener: (_type, fn) => void listeners.delete(fn),
  };
  return {
    api: () => mql,
    set(value: boolean) {
      mql.matches = value;
      for (const fn of listeners) fn({ matches: value });
    },
  };
}

describe('offline como override derivado', () => {
  it('tapa el estado efectivo pero conserva requested', () => {
    const net = fakeConnectivity();
    const core = createTessCore({ connectivity: net.api });
    core.setState('thinking');
    net.set(false);
    expect(core.getSnapshot()).toMatchObject({
      state: 'offline',
      requested: 'thinking',
      online: false,
    });
  });

  it('restaura el estado en curso al reconectar', () => {
    const net = fakeConnectivity();
    const core = createTessCore({ connectivity: net.api });
    core.setState('thinking');
    net.set(false);
    net.set(true);
    expect(core.getSnapshot().state).toBe('thinking');
  });

  it('si el transitorio venció durante el corte, reconecta en idle', () => {
    const net = fakeConnectivity();
    const core = createTessCore({ connectivity: net.api });
    core.setState('success');
    net.set(false);
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success);
    net.set(true);
    expect(core.getSnapshot().state).toBe('idle');
  });

  it('arranca en offline si no hay red', () => {
    const net = fakeConnectivity(false);
    const core = createTessCore({ connectivity: net.api });
    expect(core.getSnapshot().state).toBe('offline');
  });
});

describe('reduced-motion', () => {
  it('se lee al arrancar', () => {
    const media = fakeMedia(true);
    const core = createTessCore({ media: media.api });
    expect(core.getSnapshot().reducedMotion).toBe(true);
  });

  it('notifica cuando cambia, sin tocar el estado', () => {
    const media = fakeMedia(false);
    const core = createTessCore({ media: media.api });
    const seen = vi.fn();
    core.subscribe(seen);
    core.setState('listening');
    seen.mockClear();
    media.set(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(core.getSnapshot()).toMatchObject({
      state: 'listening',
      reducedMotion: true,
    });
  });

  it('destroy desengancha los listeners del entorno', () => {
    const net = fakeConnectivity();
    const media = fakeMedia(false);
    const core = createTessCore({ connectivity: net.api, media: media.api });
    const seen = vi.fn();
    core.subscribe(seen);
    core.destroy();
    net.set(false);
    media.set(true);
    expect(seen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-core test environment`
Expected: FAIL — `connectivity` y `media` se ignoran.

- [ ] **Step 3: Implementar los adaptadores del navegador**

Crear `packages/tess-core/src/environment.ts`:

```ts
import type { ConnectivityLike, MediaQueryListLike } from './core.js';

/** Adaptador de conectividad. En SSR asume online y no se suscribe a nada. */
export function browserConnectivity(): ConnectivityLike {
  const hasWindow = typeof globalThis.window !== 'undefined';
  return {
    isOnline: () =>
      hasWindow && typeof navigator !== 'undefined' ? navigator.onLine : true,
    subscribe(fn) {
      if (!hasWindow) return () => {};
      const goOnline = () => fn(true);
      const goOffline = () => fn(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    },
  };
}

/** Adaptador de media queries. Devuelve null en SSR. */
export function browserMedia(query: string): MediaQueryListLike | null {
  if (typeof globalThis.matchMedia !== 'function') return null;
  return globalThis.matchMedia(query);
}
```

- [ ] **Step 4: Cablear entorno en el core**

En `packages/tess-core/src/core.ts`, importar los adaptadores:

```ts
import { browserConnectivity, browserMedia } from './environment.js';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
```

Dentro de `createTessCore`, reemplazar las constantes `reducedMotion` y `online` por:

```ts
const connectivity = options.connectivity ?? browserConnectivity();
const media = (options.media ?? browserMedia)(REDUCED_MOTION_QUERY);

let online = connectivity.isOnline();
let reducedMotion = media?.matches ?? false;

const onConnectivity = (value: boolean): void => {
  if (destroyed || value === online) return;
  const previous = getSnapshot();
  online = value;
  emit(previous);
};

const onMedia = (event: { matches: boolean }): void => {
  if (destroyed || event.matches === reducedMotion) return;
  const previous = getSnapshot();
  reducedMotion = event.matches;
  emit(previous);
};

const unsubscribeConnectivity = connectivity.subscribe(onConnectivity);
media?.addEventListener('change', onMedia);
```

Y en `destroy()`, antes de `listeners.clear()`:

```ts
unsubscribeConnectivity();
media?.removeEventListener('change', onMedia);
```

- [ ] **Step 5: Ejecutar toda la suite del core**

Run: `pnpm --filter @teams4soft/tess-core test && pnpm --filter @teams4soft/tess-core typecheck && pnpm --filter @teams4soft/tess-core lint`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tess-core
git commit -m "feat(core): offline como override derivado y señal de reduced-motion"
```

---

### Task 5: `tess-rive` — traducción de estado a inputs

Aquí se resuelve el desajuste entre `AssistantState` y el contrato del `.riv`: booleanos continuos frente a triggers de un disparo.

**Files:**

- Create: `packages/tess-rive/src/mount.ts`
- Create: `packages/tess-rive/src/mount.test.ts`
- Create: `packages/tess-rive/vitest.config.ts`
- Modify: `packages/tess-rive/src/index.ts`
- Modify: `packages/tess-rive/package.json`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**

- Consumes: `TessCore`, `TessSnapshot` de Tasks 2-4; `ARTBOARD_NAME`, `STATE_MACHINE_NAME`, `RIVE_TRIGGERS`, `RIVE_BOOLEANS` de `./contract.js`.
- Produces: `mountTessRive(options)`, `TessRiveHandle` con `greet()` y `destroy()`, `MountTessRiveOptions`.

- [ ] **Step 1: Añadir jsdom al catálogo**

En `pnpm-workspace.yaml`, dentro de `catalog:`, bajo la sección `# Toolchain`:

```yaml
jsdom: ^30.1.0
```

Añadir a `devDependencies` de `packages/tess-rive/package.json`:

```json
    "jsdom": "catalog:"
```

Luego: `pnpm install`

- [ ] **Step 2: Configurar vitest con jsdom**

Crear `packages/tess-rive/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// jsdom es necesario aunque el runtime de Rive vaya mockeado: el módulo usa
// HTMLCanvasElement, IntersectionObserver y ResizeObserver.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

Crear `packages/tess-rive/src/test-setup.ts`:

```ts
import { vi } from 'vitest';

class ObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

vi.stubGlobal('IntersectionObserver', ObserverStub);
vi.stubGlobal('ResizeObserver', ObserverStub);
```

- [ ] **Step 3: Escribir el test que falla**

Crear `packages/tess-rive/src/mount.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTessCore } from '@teams4soft/tess-core';
import { RIVE_BOOLEANS, RIVE_TRIGGERS } from './contract.js';
import { mountTessRive } from './mount.js';

const inputs = new Map<
  string,
  { name: string; value: boolean; fire: ReturnType<typeof vi.fn> }
>();

function makeInput(name: string) {
  const input = { name, value: false, fire: vi.fn() };
  inputs.set(name, input);
  return input;
}

const riveInstance = {
  stateMachineInputs: vi.fn(() => [...inputs.values()]),
  cleanup: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  resizeDrawingSurfaceToCanvas: vi.fn(),
};

vi.mock('@rive-app/canvas', () => ({
  Rive: class {
    constructor(options: { onLoad?: () => void }) {
      Object.assign(this, riveInstance);
      queueMicrotask(() => options.onLoad?.());
    }
  },
  Layout: class {},
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}));

beforeEach(async () => {
  inputs.clear();
  for (const name of Object.values(RIVE_BOOLEANS)) makeInput(name);
  for (const name of Object.values(RIVE_TRIGGERS)) makeInput(name);
  vi.clearAllMocks();
});

async function mount() {
  const core = createTessCore();
  const canvas = document.createElement('canvas');
  const handle = mountTessRive({ canvas, core });
  await Promise.resolve();
  return { core, handle };
}

describe('traducción de estado a inputs', () => {
  it('activa solo el booleano del estado actual', async () => {
    const { core } = await mount();
    core.setState('thinking');
    expect(inputs.get(RIVE_BOOLEANS.thinking)!.value).toBe(true);
    expect(inputs.get(RIVE_BOOLEANS.listening)!.value).toBe(false);
    expect(inputs.get(RIVE_BOOLEANS.speaking)!.value).toBe(false);
  });

  it('apaga todos los booleanos en idle y en offline', async () => {
    const { core } = await mount();
    core.setState('speaking');
    core.setState('idle');
    expect(inputs.get(RIVE_BOOLEANS.speaking)!.value).toBe(false);
  });

  it('dispara el trigger al entrar en success', async () => {
    const { core } = await mount();
    core.setState('success');
    expect(inputs.get(RIVE_TRIGGERS.success)!.fire).toHaveBeenCalledTimes(1);
  });

  it('no re-dispara el trigger si cambia otra señal', async () => {
    const { core } = await mount();
    core.setState('error');
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);
    // Una notificación que no cambia el estado no puede relanzar la animación.
    core.setState('error');
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);
  });

  it('propaga reduced-motion como booleano', async () => {
    const core = createTessCore({
      media: () => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });
    await Promise.resolve();
    expect(inputs.get(RIVE_BOOLEANS.reducedMotion)!.value).toBe(true);
  });

  it('greet() dispara el trigger decorativo', async () => {
    const { handle } = await mount();
    handle.greet();
    expect(inputs.get(RIVE_TRIGGERS.greet)!.fire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-rive test`
Expected: FAIL — no existe `./mount.js`.

- [ ] **Step 5: Implementar el montaje y la traducción**

Crear `packages/tess-rive/src/mount.ts`:

```ts
import { Alignment, Fit, Layout, Rive } from '@rive-app/canvas';
import type { TessCore, TessSnapshot } from '@teams4soft/tess-core';
import {
  ARTBOARD_NAME,
  RIVE_BOOLEANS,
  RIVE_TRIGGERS,
  STATE_MACHINE_NAME,
} from './contract.js';

export interface MountTessRiveOptions {
  canvas: HTMLCanvasElement;
  core: TessCore;
  /** Ruta al .riv. Por defecto, el asset empaquetado con este paquete. */
  src?: string;
  onError?: (error: Error) => void;
}

export interface TessRiveHandle {
  /** Saludo decorativo. No es un AssistantState. */
  greet(): void;
  destroy(): void;
}

const DEFAULT_SRC = new URL('../assets/teams4soft-tess.riv', import.meta.url)
  .href;

interface RiveInput {
  name: string;
  value: boolean;
  fire(): void;
}

export function mountTessRive(options: MountTessRiveOptions): TessRiveHandle {
  const { canvas, core, src = DEFAULT_SRC } = options;
  const onError = options.onError ?? (() => {});

  let destroyed = false;
  let inputs = new Map<string, RiveInput>();
  let previous: TessSnapshot | undefined;

  const rive = new Rive({
    canvas,
    src,
    artboard: ARTBOARD_NAME,
    stateMachines: STATE_MACHINE_NAME,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => {
      if (destroyed) return;
      inputs = new Map(
        (rive.stateMachineInputs(STATE_MACHINE_NAME) as RiveInput[]).map(
          (input) => [input.name, input],
        ),
      );
      apply(core.getSnapshot());
    },
    onLoadError: () => onError(new Error(`No se pudo cargar el .riv: ${src}`)),
  });

  function bool(name: string, value: boolean): void {
    const input = inputs.get(name);
    if (input) input.value = value;
  }

  function fire(name: string): void {
    inputs.get(name)?.fire();
  }

  function apply(snapshot: TessSnapshot): void {
    bool(RIVE_BOOLEANS.listening, snapshot.state === 'listening');
    bool(RIVE_BOOLEANS.thinking, snapshot.state === 'thinking');
    bool(RIVE_BOOLEANS.speaking, snapshot.state === 'speaking');
    bool(RIVE_BOOLEANS.reducedMotion, snapshot.reducedMotion);

    // Los triggers son de un disparo: solo al ENTRAR en el estado. Sin esta
    // comparación, un cambio de reducedMotion relanzaría la animación.
    if (snapshot.state !== previous?.state) {
      if (snapshot.state === 'success') fire(RIVE_TRIGGERS.success);
      else if (snapshot.state === 'error') fire(RIVE_TRIGGERS.error);
    }
    previous = snapshot;
  }

  const unsubscribe = core.subscribe(apply);

  return {
    greet: () => fire(RIVE_TRIGGERS.greet),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      rive.cleanup();
    },
  };
}
```

- [ ] **Step 6: Reexportar desde el índice**

Añadir a `packages/tess-rive/src/index.ts`:

```ts
export * from './mount.js';
```

- [ ] **Step 7: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @teams4soft/tess-rive test`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/tess-rive pnpm-workspace.yaml
git commit -m "feat(rive): traducir AssistantState a inputs de TessStateMachine"
```

---

### Task 6: `tess-rive` — ciclo de vida del canvas

Pausa fuera de viewport, nitidez en pantallas HiDPI y una limpieza que no deje nada colgando.

**Files:**

- Modify: `packages/tess-rive/src/mount.ts`
- Create: `packages/tess-rive/src/lifecycle.test.ts`

**Interfaces:**

- Consumes: `mountTessRive` de Task 5.
- Produces: sin API nueva; `destroy()` pasa a desconectar observers.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-rive/src/lifecycle.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTessCore } from '@teams4soft/tess-core';
import { mountTessRive } from './mount.js';

const riveInstance = {
  stateMachineInputs: vi.fn(() => []),
  cleanup: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  resizeDrawingSurfaceToCanvas: vi.fn(),
};

let intersectionCallback:
  ((entries: { isIntersecting: boolean }[]) => void) | undefined;
const observerInstances: { disconnect: ReturnType<typeof vi.fn> }[] = [];

vi.mock('@rive-app/canvas', () => ({
  Rive: class {
    constructor(options: {
      src: string;
      onLoad?: () => void;
      onLoadError?: () => void;
    }) {
      Object.assign(this, riveInstance);
      queueMicrotask(() => {
        // El .riv inexistente ejercita la rama de error.
        if (options.src.includes('no-existe')) options.onLoadError?.();
        else options.onLoad?.();
      });
    }
  },
  Layout: class {},
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}));

beforeEach(() => {
  vi.clearAllMocks();
  observerInstances.length = 0;
  intersectionCallback = undefined;

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        intersectionCallback = cb;
        observerInstances.push(this);
      }
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor() {
        observerInstances.push(this);
      }
    },
  );
});

function mount() {
  const core = createTessCore();
  const canvas = document.createElement('canvas');
  return { core, handle: mountTessRive({ canvas, core }) };
}

describe('ciclo de vida', () => {
  it('pausa al salir del viewport y reanuda al volver', () => {
    mount();
    intersectionCallback!([{ isIntersecting: false }]);
    expect(riveInstance.pause).toHaveBeenCalledTimes(1);
    intersectionCallback!([{ isIntersecting: true }]);
    expect(riveInstance.play).toHaveBeenCalledTimes(1);
  });

  it('destroy limpia Rive, ambos observers y la suscripción', () => {
    const { core, handle } = mount();
    handle.destroy();
    expect(riveInstance.cleanup).toHaveBeenCalledTimes(1);
    for (const observer of observerInstances) {
      expect(observer.disconnect).toHaveBeenCalledTimes(1);
    }
    // Si la suscripción siguiera viva, esto lanzaría contra inputs limpiados.
    expect(() => core.setState('thinking')).not.toThrow();
  });

  it('destroy es idempotente', () => {
    const { handle } = mount();
    handle.destroy();
    handle.destroy();
    expect(riveInstance.cleanup).toHaveBeenCalledTimes(1);
  });

  it('reporta el fallo de carga por onError en vez de lanzar', async () => {
    const onError = vi.fn();
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    expect(() =>
      mountTessRive({ canvas, core, src: '/no-existe.riv', onError }),
    ).not.toThrow();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toContain('/no-existe.riv');
  });

  it('un estado que llega antes de onLoad no rompe', () => {
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });
    // Sin esperar al microtask: el mapa de inputs todavía está vacío.
    expect(() => core.setState('thinking')).not.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-rive test lifecycle`
Expected: FAIL — `pause` nunca se llama; los observers no existen.

- [ ] **Step 3: Añadir observers y limpieza**

En `packages/tess-rive/src/mount.ts`, dentro de `mountTessRive`, antes del `return`:

```ts
// Pausa fuera de viewport: un avatar que no se ve no debe gastar frames.
const viewport = new IntersectionObserver((entries) => {
  if (destroyed) return;
  const visible = entries.some((entry) => entry.isIntersecting);
  if (visible) rive.play();
  else rive.pause();
});
viewport.observe(canvas);

// Nitidez en HiDPI: el buffer del canvas debe seguir a su tamaño en CSS.
const resize = new ResizeObserver(() => {
  if (destroyed) return;
  rive.resizeDrawingSurfaceToCanvas();
});
resize.observe(canvas);
```

Y dentro de `destroy()`, entre `unsubscribe()` y `rive.cleanup()`:

```ts
viewport.disconnect();
resize.disconnect();
```

- [ ] **Step 4: Ejecutar toda la suite de tess-rive**

Run: `pnpm --filter @teams4soft/tess-rive test && pnpm --filter @teams4soft/tess-rive typecheck && pnpm --filter @teams4soft/tess-rive lint`
Expected: PASS, 11 tests (6 de Task 5 + 5 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/tess-rive
git commit -m "feat(rive): pausa fuera de viewport, resize HiDPI y destroy completo"
```

---

### Task 7: `tess-web-component` — launcher, atributos y estilos

El custom element con su shadow DOM, el launcher accesible y el avatar montado dentro.

**Files:**

- Create: `packages/tess-web-component/src/element.ts`
- Create: `packages/tess-web-component/src/styles.ts`
- Create: `packages/tess-web-component/src/element.test.ts`
- Create: `packages/tess-web-component/vitest.config.ts`
- Modify: `packages/tess-web-component/src/index.ts`
- Modify: `packages/tess-web-component/package.json`

**Interfaces:**

- Consumes: `createTessCore` (Tasks 2-4), `mountTessRive` (Tasks 5-6), `THEMES`/`SIZES`/`POSITIONS`/`DEFAULT_SIZE`/`DEFAULT_POSITION`/`TessAssistantConfig` (Task 1).
- Produces: clase `TessAssistantElement` registrada como `teams4soft-assistant`; propiedades `state`, `theme`, `size`, `position`; método `destroy()`; eventos `tess:state`, `tess:error`; `LABELS` por locale.

- [ ] **Step 1: Configurar vitest con jsdom**

Añadir `"jsdom": "catalog:"` a `devDependencies` de `packages/tess-web-component/package.json`, luego `pnpm install`.

Crear `packages/tess-web-component/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

Crear `packages/tess-web-component/src/test-setup.ts`:

```ts
import { vi } from 'vitest';

class ObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

vi.stubGlobal('IntersectionObserver', ObserverStub);
vi.stubGlobal('ResizeObserver', ObserverStub);

// El runtime de Rive necesita WebGL/canvas real; en jsdom se mockea entero.
vi.mock('@teams4soft/tess-rive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@teams4soft/tess-rive')>();
  return {
    ...actual,
    mountTessRive: vi.fn(() => ({ greet: vi.fn(), destroy: vi.fn() })),
  };
});
```

- [ ] **Step 2: Escribir el test que falla**

Crear `packages/tess-web-component/src/element.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './index.js';

function create(): HTMLElement & { state: string; destroy(): void } {
  const element = document.createElement(TAG_NAME) as HTMLElement & {
    state: string;
    destroy(): void;
  };
  document.body.append(element);
  return element;
}

beforeEach(async () => {
  await import('./element.js');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('teams4soft-assistant', () => {
  it('se registra como custom element', () => {
    expect(customElements.get(TAG_NAME)).toBeTypeOf('function');
  });

  it('monta un shadow root abierto con launcher accesible', () => {
    const element = create();
    const launcher = element.shadowRoot!.querySelector(
      'button[part="launcher"]',
    );
    expect(launcher).not.toBeNull();
    expect(launcher!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(launcher!.getAttribute('aria-expanded')).toBe('false');
    expect(launcher!.getAttribute('aria-label')).toBeTruthy();
  });

  it('refleja el atributo state en la propiedad', () => {
    const element = create();
    element.setAttribute('state', 'thinking');
    expect(element.state).toBe('thinking');
  });

  it('emite tess:state cuando el estado cambia', () => {
    const element = create();
    const seen = vi.fn();
    element.addEventListener('tess:state', seen);
    element.setAttribute('state', 'listening');
    expect(seen).toHaveBeenCalledTimes(1);
    expect((seen.mock.calls[0][0] as CustomEvent).detail.state).toBe(
      'listening',
    );
  });

  it('usa las etiquetas del locale pedido', () => {
    const element = create();
    element.setAttribute('locale', 'en');
    const launcher = element.shadowRoot!.querySelector(
      'button[part="launcher"]',
    )!;
    expect(launcher.getAttribute('aria-label')).toBe('Open the Tess assistant');
  });

  it('cae al español si el locale no está soportado', () => {
    const element = create();
    element.setAttribute('locale', 'de');
    const launcher = element.shadowRoot!.querySelector(
      'button[part="launcher"]',
    )!;
    expect(launcher.getAttribute('aria-label')).toBe('Abrir el asistente Tess');
  });

  it('un size inválido cae a 96 y emite tess:error', () => {
    const element = create();
    const seen = vi.fn();
    element.addEventListener('tess:error', seen);
    element.setAttribute('size', '999');
    expect(element.getAttribute('size')).toBe('96');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('destroy deja el shadow root vacío y desconecta el core', () => {
    const element = create();
    element.destroy();
    expect(
      element.shadowRoot!.querySelector('button[part="launcher"]'),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-web-component test`
Expected: FAIL — no existe `./element.js`.

- [ ] **Step 4: Escribir las etiquetas accesibles**

Crear `packages/tess-web-component/src/labels.ts`:

```ts
/**
 * Único texto de Fase 1. El diálogo va vacío, así que `locale` solo gobierna
 * las etiquetas accesibles del launcher y del panel.
 */
export const LABELS = {
  es: { launcher: 'Abrir el asistente Tess', dialog: 'Asistente Tess' },
  en: { launcher: 'Open the Tess assistant', dialog: 'Tess assistant' },
} as const;

export type TessLocale = keyof typeof LABELS;
export const DEFAULT_LOCALE: TessLocale = 'es';

export function labelsFor(locale: string | null | undefined) {
  return LABELS[locale as TessLocale] ?? LABELS[DEFAULT_LOCALE];
}
```

- [ ] **Step 5: Escribir los estilos del shadow DOM**

Crear `packages/tess-web-component/src/styles.ts`:

```ts
/**
 * Estilos del shadow DOM. `theme` controla SOLO este chrome: el avatar Rive
 * conserva su paleta propia, porque TessStateMachine no declara inputs de
 * color.
 */
export const STYLES = `
  :host {
    --tess-bg: #ffffff;
    --tess-fg: #101418;
    --tess-border: rgba(16, 20, 24, 0.12);
    --tess-shadow: 0 8px 32px rgba(16, 20, 24, 0.18);
    --tess-size: 96px;
    --tess-gap: 16px;
    position: fixed;
    z-index: 2147483000;
    font-family: system-ui, sans-serif;
  }
  :host([theme='dark']) {
    --tess-bg: #16191d;
    --tess-fg: #f2f4f7;
    --tess-border: rgba(242, 244, 247, 0.16);
  }
  @media (prefers-color-scheme: dark) {
    :host([theme='auto']) {
      --tess-bg: #16191d;
      --tess-fg: #f2f4f7;
      --tess-border: rgba(242, 244, 247, 0.16);
    }
  }
  :host([position='bottom-right']) { inset: auto var(--tess-gap) var(--tess-gap) auto; }
  :host([position='bottom-left'])  { inset: auto auto var(--tess-gap) var(--tess-gap); }
  :host([position='top-right'])    { inset: var(--tess-gap) var(--tess-gap) auto auto; }
  :host([position='top-left'])     { inset: var(--tess-gap) auto auto var(--tess-gap); }

  button[part='launcher'] {
    width: var(--tess-size);
    height: var(--tess-size);
    padding: 0;
    border: 1px solid var(--tess-border);
    border-radius: 50%;
    background: var(--tess-bg);
    box-shadow: var(--tess-shadow);
    cursor: pointer;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  button[part='launcher']:focus-visible {
    outline: 3px solid Highlight;
    outline-offset: 2px;
  }
  canvas { width: 100%; height: 100%; display: block; }

  /* Fallback si el .riv no carga: el botón nunca queda en blanco. */
  .fallback {
    width: 60%;
    height: 60%;
    border-radius: 50%;
    background: linear-gradient(135deg, #5b8def, #9b6bdf);
  }
  .hidden { display: none; }
`;
```

- [ ] **Step 6: Implementar el custom element**

Crear `packages/tess-web-component/src/element.ts`:

```ts
import { createTessCore, type TessCore } from '@teams4soft/tess-core';
import { mountTessRive, type TessRiveHandle } from '@teams4soft/tess-rive';
import {
  DEFAULT_POSITION,
  DEFAULT_SIZE,
  POSITIONS,
  SIZES,
  THEMES,
  isRequestedState,
  type TessAssistantConfig,
  type TessErrorDetail,
  type TessStateDetail,
} from '@teams4soft/tess-types';
import { labelsFor } from './labels.js';
import { STYLES } from './styles.js';

export const TAG_NAME = 'teams4soft-assistant';

const OBSERVED = [
  'state',
  'theme',
  'size',
  'position',
  'api-url',
  'locale',
] as const;

export class TessAssistantElement extends HTMLElement {
  static readonly observedAttributes = OBSERVED;

  #core: TessCore | undefined;
  #rive: TessRiveHandle | undefined;
  #launcher: HTMLButtonElement | undefined;
  // Lo crea la Task 8; aquí se declara para que el manejador de `locale`
  // pueda actualizar su etiqueta sin referencias adelantadas.
  #dialog: HTMLDialogElement | undefined;
  #fallback: HTMLSpanElement | undefined;
  #unsubscribe: (() => void) | undefined;
  #config: TessAssistantConfig = {};

  get state(): string {
    return this.#core?.getSnapshot().state ?? 'idle';
  }

  connectedCallback(): void {
    if (this.#core) return;
    if (!this.hasAttribute('theme')) this.setAttribute('theme', 'auto');
    if (!this.hasAttribute('size'))
      this.setAttribute('size', String(DEFAULT_SIZE));
    if (!this.hasAttribute('position'))
      this.setAttribute('position', DEFAULT_POSITION);

    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.setAttribute('part', 'launcher');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute(
      'aria-label',
      labelsFor(this.getAttribute('locale')).launcher,
    );

    const canvas = document.createElement('canvas');
    const fallback = document.createElement('span');
    fallback.className = 'fallback hidden';
    fallback.setAttribute('aria-hidden', 'true');
    launcher.append(canvas, fallback);

    root.append(style, launcher);

    this.#launcher = launcher;
    this.#fallback = fallback;
    this.#core = createTessCore({
      onError: (error) => this.#emitError('core', error),
    });
    this.#unsubscribe = this.#core.subscribe((snapshot) => {
      this.dispatchEvent(
        new CustomEvent<TessStateDetail>('tess:state', {
          detail: { state: snapshot.state },
          bubbles: true,
          composed: true,
        }),
      );
    });

    this.#rive = mountTessRive({
      canvas,
      core: this.#core,
      onError: (error) => {
        canvas.classList.add('hidden');
        this.#fallback?.classList.remove('hidden');
        this.#emitError('rive-load', error);
      },
    });

    this.#syncSize();
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    if (!this.#core) return;
    if (name === 'state' && value !== null) {
      if (isRequestedState(value)) this.#core.setState(value);
      else
        this.#emitError('bad-state', new Error(`Estado desconocido: ${value}`));
    }
    if (name === 'size') this.#syncSize();
    if (
      name === 'theme' &&
      value !== null &&
      !THEMES.includes(value as never)
    ) {
      this.setAttribute('theme', 'auto');
    }
    if (
      name === 'position' &&
      value !== null &&
      !POSITIONS.includes(value as never)
    ) {
      this.setAttribute('position', DEFAULT_POSITION);
    }
    if (name === 'api-url') this.#config.apiUrl = value ?? undefined;
    if (name === 'locale') {
      this.#config.locale = value ?? undefined;
      const labels = labelsFor(value);
      this.#launcher?.setAttribute('aria-label', labels.launcher);
      this.#dialog?.setAttribute('aria-label', labels.dialog);
    }
  }

  destroy(): void {
    this.#unsubscribe?.();
    this.#rive?.destroy();
    this.#core?.destroy();
    this.#unsubscribe = undefined;
    this.#rive = undefined;
    this.#core = undefined;
    this.#launcher = undefined;
    this.#fallback = undefined;
    if (this.shadowRoot) this.shadowRoot.replaceChildren();
  }

  #syncSize(): void {
    const raw = Number(this.getAttribute('size'));
    if (!SIZES.includes(raw as never)) {
      this.#emitError(
        'bad-size',
        new Error(`Tamaño no soportado: ${this.getAttribute('size')}`),
      );
      this.setAttribute('size', String(DEFAULT_SIZE));
      return;
    }
    this.style.setProperty('--tess-size', `${raw}px`);
  }

  #emitError(code: string, error: Error): void {
    this.dispatchEvent(
      new CustomEvent<TessErrorDetail>('tess:error', {
        detail: { code, message: error.message },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, TessAssistantElement);
}
```

- [ ] **Step 7: Registrar desde el índice**

Reemplazar el `export const TAG_NAME` de `packages/tess-web-component/src/index.ts` por:

```ts
import './element.js';

export { TAG_NAME, TessAssistantElement } from './element.js';
```

- [ ] **Step 8: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @teams4soft/tess-web-component test`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/tess-web-component
git commit -m "feat(web-component): launcher flotante accesible con avatar y fallback CSS"
```

---

### Task 8: `tess-web-component` — diálogo no modal y teclado

`<dialog>` con `show()`: la página sigue usable. A cambio, Escape y el foco se gestionan a mano.

**Files:**

- Modify: `packages/tess-web-component/src/element.ts`
- Modify: `packages/tess-web-component/src/styles.ts`
- Create: `packages/tess-web-component/src/dialog.test.ts`

**Interfaces:**

- Consumes: `TessAssistantElement` de Task 7.
- Produces: `openChat()`, `closeChat()`; eventos `tess:open`, `tess:close`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-web-component/src/dialog.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './index.js';

type Element = HTMLElement & { openChat(): void; closeChat(): void };

function create(): Element {
  const element = document.createElement(TAG_NAME) as Element;
  document.body.append(element);
  return element;
}

beforeEach(async () => {
  await import('./element.js');
  // jsdom no implementa show()/close() de <dialog>.
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('diálogo no modal', () => {
  it('abre con show(), no con showModal()', () => {
    const element = create();
    const dialog = element.shadowRoot!.querySelector('dialog')!;
    const showModal = vi.fn();
    dialog.showModal = showModal;
    element.openChat();
    expect(dialog.open).toBe(true);
    expect(showModal).not.toHaveBeenCalled();
  });

  it('actualiza aria-expanded del launcher', () => {
    const element = create();
    const launcher = element.shadowRoot!.querySelector(
      'button[part="launcher"]',
    )!;
    element.openChat();
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    element.closeChat();
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
  });

  it('emite tess:open y tess:close', () => {
    const element = create();
    const opened = vi.fn();
    const closed = vi.fn();
    element.addEventListener('tess:open', opened);
    element.addEventListener('tess:close', closed);
    element.openChat();
    element.closeChat();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('cierra con Escape', () => {
    const element = create();
    const dialog = element.shadowRoot!.querySelector('dialog')!;
    element.openChat();
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(dialog.open).toBe(false);
  });

  it('devuelve el foco al launcher al cerrar', () => {
    const element = create();
    const launcher = element.shadowRoot!.querySelector<HTMLButtonElement>(
      'button[part="launcher"]',
    )!;
    const focus = vi.spyOn(launcher, 'focus');
    element.openChat();
    element.closeChat();
    expect(focus).toHaveBeenCalled();
  });

  it('abrir dos veces no duplica eventos', () => {
    const element = create();
    const opened = vi.fn();
    element.addEventListener('tess:open', opened);
    element.openChat();
    element.openChat();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-web-component test dialog`
Expected: FAIL — no hay `<dialog>` en el shadow root.

- [ ] **Step 3: Añadir estilos del diálogo**

Añadir al final de la plantilla `STYLES` en `packages/tess-web-component/src/styles.ts`:

```ts
  dialog[part='dialog'] {
    position: absolute;
    bottom: calc(var(--tess-size) + 12px);
    right: 0;
    width: min(360px, calc(100vw - 32px));
    height: min(480px, calc(100vh - 32px));
    margin: 0;
    padding: 16px;
    border: 1px solid var(--tess-border);
    border-radius: 16px;
    background: var(--tess-bg);
    color: var(--tess-fg);
    box-shadow: var(--tess-shadow);
  }
  :host([position^='top']) dialog[part='dialog'] {
    bottom: auto;
    top: calc(var(--tess-size) + 12px);
  }
  :host([position$='left']) dialog[part='dialog'] { right: auto; left: 0; }
  dialog[part='dialog']:not([open]) { display: none; }
```

- [ ] **Step 4: Implementar el diálogo en el elemento**

El campo `#dialog` ya se declaró en la Task 7. En `connectedCallback`, tras crear el launcher y antes de `root.append(...)`:

```ts
const dialog = document.createElement('dialog');
dialog.setAttribute('part', 'dialog');
dialog.setAttribute(
  'aria-label',
  labelsFor(this.getAttribute('locale')).dialog,
);
dialog.id = `tess-dialog-${Math.random().toString(36).slice(2, 8)}`;
// El panel de conversación llega en Fase 2: aquí solo va la cáscara.
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    this.closeChat();
  }
});
launcher.setAttribute('aria-controls', dialog.id);
launcher.addEventListener('click', () => {
  if (dialog.open) this.closeChat();
  else this.openChat();
});
this.#dialog = dialog;
```

Cambiar el append a `root.append(style, launcher, dialog);`

Añadir los métodos públicos:

```ts
  openChat(): void {
    const dialog = this.#dialog;
    if (!dialog || dialog.open) return;
    // show(), no showModal(): el usuario debe poder seguir leyendo la página.
    dialog.show();
    this.#launcher?.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    this.#rive?.greet();
    dialog.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )?.focus();
    this.dispatchEvent(new CustomEvent('tess:open', { bubbles: true, composed: true }));
  }

  closeChat(): void {
    const dialog = this.#dialog;
    if (!dialog || !dialog.open) return;
    dialog.close();
    this.#launcher?.setAttribute('aria-expanded', 'false');
    this.removeAttribute('open');
    this.#launcher?.focus();
    this.dispatchEvent(new CustomEvent('tess:close', { bubbles: true, composed: true }));
  }
```

Añadir `this.#dialog = undefined;` dentro de `destroy()`.

- [ ] **Step 5: Ejecutar toda la suite del web component**

Run: `pnpm --filter @teams4soft/tess-web-component test && pnpm --filter @teams4soft/tess-web-component typecheck && pnpm --filter @teams4soft/tess-web-component lint`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tess-web-component
git commit -m "feat(web-component): diálogo no modal con Escape y devolución de foco"
```

---

### Task 9: `tess-client` — cliente noop y punto de inyección

Congela la costura con F2. Es la tarea más pequeña del plan y la que más trabajo ahorra después.

**Files:**

- Modify: `packages/tess-client/src/index.ts`
- Create: `packages/tess-client/src/noop.test.ts`
- Modify: `packages/tess-web-component/src/element.ts`
- Modify: `packages/tess-web-component/package.json`

**Interfaces:**

- Consumes: `TessClientLike`, `SendMessageInput` de Task 1.
- Produces: `createNoopTessClient()`; `TessAssistantElement.setClient(client)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/tess-client/src/noop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNoopTessClient } from './index.js';

describe('createNoopTessClient', () => {
  it('satisface TessClientLike sin emitir eventos', async () => {
    const client = createNoopTessClient();
    const received = [];
    for await (const event of client.sendMessage({
      conversationId: 'c1',
      text: 'hola',
    })) {
      received.push(event);
    }
    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @teams4soft/tess-client test`
Expected: FAIL — `createNoopTessClient` no existe.

- [ ] **Step 3: Implementar el cliente noop**

Añadir a `packages/tess-client/src/index.ts`:

```ts
import type { SendMessageInput, TessClientLike } from '@teams4soft/tess-types';

/**
 * Cliente inerte de Fase 1.
 *
 * Existe para que el web component dependa de `TessClientLike` y no de una
 * implementación concreta. En Fase 2 se sustituye por `createTessClient`
 * sin tocar la API pública del componente.
 */
export function createNoopTessClient(): TessClientLike {
  return {
    // eslint-disable-next-line require-yield
    async *sendMessage(_input: SendMessageInput) {
      return;
    },
  };
}
```

Verificar que `@teams4soft/tess-types` está en `dependencies` de `packages/tess-client/package.json`; añadirlo con `workspace:*` si falta.

- [ ] **Step 4: Añadir el punto de inyección al web component**

Añadir `"@teams4soft/tess-client": "workspace:*"` a `dependencies` de `packages/tess-web-component/package.json` si no está, y `pnpm install`.

En `packages/tess-web-component/src/element.ts`, añadir el import y el campo:

```ts
import { createNoopTessClient } from '@teams4soft/tess-client';
import type { TessClientLike } from '@teams4soft/tess-types';
```

```ts
  #client: TessClientLike = createNoopTessClient();
```

Y el método público:

```ts
  /**
   * Punto de inyección congelado en Fase 1.
   *
   * Fase 2 solo sustituye la implementación: ni los atributos, ni los métodos,
   * ni los eventos de este elemento cambian por conectar el backend.
   */
  setClient(client: TessClientLike): void {
    this.#client = client;
  }
```

- [ ] **Step 5: Ejecutar los tests de ambos paquetes**

Run: `pnpm --filter @teams4soft/tess-client test && pnpm --filter @teams4soft/tess-web-component test`
Expected: PASS en ambos.

- [ ] **Step 6: Commit**

```bash
git add packages/tess-client packages/tess-web-component
git commit -m "feat(client): cliente noop y setClient para congelar la costura con F2"
```

---

### Task 10: `tess-svelte` — wrapper

Una envoltura del mismo núcleo, no una implementación paralela.

**Files:**

- Create: `packages/tess-svelte/src/Tess.svelte`
- Modify: `packages/tess-svelte/src/index.ts`
- Modify: `packages/tess-svelte/package.json`
- Delete: `packages/tess-svelte/tsup.config.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**

- Consumes: el custom element de Tasks 7-9.
- Produces: componente Svelte `Tess` con props `state`, `theme`, `size`, `position`, `apiUrl`, `locale`.

- [ ] **Step 1: Añadir `@sveltejs/package` al catálogo**

En `pnpm-workspace.yaml`, en la sección `# Svelte` del catálogo:

```yaml
'@sveltejs/package': ^2.5.4
```

- [ ] **Step 2: Migrar el build del paquete**

Reemplazar en `packages/tess-svelte/package.json` los campos de build:

```json
  "svelte": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "svelte": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "svelte-package --input src --output dist",
    "dev": "svelte-package --input src --output dist --watch",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run --passWithNoTests",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  }
```

Añadir a `devDependencies`: `"@sveltejs/package": "catalog:"`, `"svelte": "catalog:"`, `"svelte-check": "catalog:"`. Añadir a `peerDependencies`: `"svelte": "^5.0.0"`. Eliminar `tsup` de `devDependencies`.

Borrar `packages/tess-svelte/tsup.config.ts` y ejecutar `pnpm install`.

- [ ] **Step 3: Escribir el componente**

Crear `packages/tess-svelte/src/Tess.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    TessPosition,
    TessSize,
    TessTheme,
  } from '@teams4soft/tess-types';

  interface Props {
    state?: string;
    theme?: TessTheme;
    size?: TessSize;
    position?: TessPosition;
    apiUrl?: string;
    locale?: string;
  }

  let {
    state = 'idle',
    theme = 'auto',
    size = 96,
    position = 'bottom-right',
    apiUrl,
    locale,
  }: Props = $props();

  // El registro del custom element es un efecto secundario del import, y solo
  // puede ocurrir en el navegador: en SSR no existe customElements.
  onMount(() => {
    void import('@teams4soft/tess-web-component');
  });
</script>

<teams4soft-assistant
  {state}
  {theme}
  {position}
  size={String(size)}
  api-url={apiUrl}
  {locale}
></teams4soft-assistant>
```

- [ ] **Step 4: Reexportar**

Reemplazar el cuerpo de `packages/tess-svelte/src/index.ts`:

```ts
export { default as Tess } from './Tess.svelte';
export { TAG_NAME } from '@teams4soft/tess-web-component';
```

- [ ] **Step 5: Construir y verificar**

Run: `pnpm --filter @teams4soft/tess-svelte build && pnpm --filter @teams4soft/tess-svelte typecheck`
Expected: PASS; `dist/Tess.svelte` y `dist/index.js` existen.

- [ ] **Step 6: Commit**

```bash
git add packages/tess-svelte pnpm-workspace.yaml
git commit -m "feat(svelte): wrapper Tess.svelte con build vía @sveltejs/package"
```

---

### Task 11: Demo — panel de pruebas

La superficie de validación manual y el entregable visible de la fase.

**Files:**

- Modify: `apps/demo-svelte/src/routes/+page.svelte`

**Interfaces:**

- Consumes: `Tess` de Task 10, `ASSISTANT_STATES`/`SIZES`/`THEMES`/`POSITIONS` de Task 1.
- Produces: nada que otras tareas consuman.

- [ ] **Step 1: Escribir el panel**

Reemplazar el contenido de `apps/demo-svelte/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { Tess } from '@teams4soft/tess-svelte';
  import {
    ASSISTANT_STATES,
    POSITIONS,
    SIZES,
    THEMES,
    type TessPosition,
    type TessSize,
    type TessTheme,
  } from '@teams4soft/tess-types';

  let state = $state('idle');
  let theme = $state<TessTheme>('auto');
  let size = $state<TessSize>(96);
  let position = $state<TessPosition>('bottom-right');
  let mounted = $state(true);
  let log = $state<string[]>([]);

  function record(event: Event) {
    const detail = (event as CustomEvent).detail;
    const stamp = new Date().toISOString().slice(11, 23);
    log = [
      `${stamp}  ${event.type}  ${JSON.stringify(detail ?? {})}`,
      ...log,
    ].slice(0, 30);
  }

  // Los eventos del custom element burbujean y son composed: se capturan aquí.
  const events = ['tess:open', 'tess:close', 'tess:state', 'tess:error'];
</script>

<svelte:window
  on:tess:open={record}
  on:tess:close={record}
  on:tess:state={record}
  on:tess:error={record}
/>

<h1>Tess — panel de pruebas</h1>

<section>
  <h2>Estado</h2>
  {#each ASSISTANT_STATES as candidate (candidate)}
    <button
      type="button"
      disabled={candidate === 'offline'}
      title={candidate === 'offline'
        ? 'Derivado de la conectividad, no se pide'
        : ''}
      onclick={() => (state = candidate)}
    >
      {candidate}
    </button>
  {/each}
  <p>Actual: <code>{state}</code></p>
</section>

<section>
  <h2>Apariencia</h2>
  <label>
    Theme
    <select bind:value={theme}>
      {#each THEMES as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
  <label>
    Size
    <select bind:value={size}>
      {#each SIZES as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
  <label>
    Position
    <select bind:value={position}>
      {#each POSITIONS as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
</section>

<section>
  <h2>Ciclo de vida</h2>
  <button type="button" onclick={() => (mounted = !mounted)}>
    {mounted ? 'destroy' : 'remount'}
  </button>
  <p>
    Para reduced-motion, actívalo en el sistema operativo o en las herramientas
    de desarrollo: el avatar debe quedarse en una pose estática.
  </p>
</section>

<section>
  <h2>Eventos ({events.length} tipos)</h2>
  <pre>{log.join('\n') || 'Sin eventos todavía.'}</pre>
</section>

{#if mounted}
  <Tess {state} {theme} {size} {position} />
{/if}

<style>
  section {
    margin-block: 1.5rem;
  }
  button {
    margin-inline-end: 0.35rem;
  }
  label {
    margin-inline-end: 1rem;
  }
  pre {
    padding: 0.75rem;
    border-radius: 8px;
    background: #11151a;
    color: #d8e0ea;
    font-size: 0.8rem;
    max-height: 14rem;
    overflow: auto;
  }
</style>
```

- [ ] **Step 2: Levantar la demo y validar a mano**

Run: `pnpm build && pnpm --filter @teams4soft/demo-svelte dev`

Comprobar en `http://localhost:5173`:

- Los seis estados solicitables mueven el avatar; `offline` está deshabilitado.
- `success` y `error` vuelven solos a `idle` y la animación **termina justo** cuando el estado cambia. Si se corta antes, ajustar `transientMs`, no el `.riv`.
- Los cuatro tamaños y las cuatro posiciones se aplican.
- Clic en el launcher abre el diálogo vacío; la página de detrás **sigue usable**.
- Solo con teclado: Tab hasta el launcher, Enter abre, Escape cierra, el foco vuelve al launcher.
- `destroy` / `remount` no acumula avatares ni deja el log disparándose.
- Con reduced-motion activo en el sistema, el avatar queda estático.

- [ ] **Step 3: Commit**

```bash
git add apps/demo-svelte
git commit -m "feat(demo): panel de pruebas con estados, apariencia y log de eventos"
```

---

### Task 12: Gate de Fase 1

Verificar lo que la spec exige antes de dar la fase por cerrada.

**Files:**

- Create: `scripts/check-bundle.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: todos los paquetes construidos.
- Produces: script `pnpm gate:f1`.

- [ ] **Step 1: Escribir el verificador del bundle**

Crear `scripts/check-bundle.mjs`:

```js
import { readFileSync } from 'node:fs';

// El web component es vanilla. Si Svelte aparece en su bundle IIFE, es una
// fuga del wrapper y rompe a cualquier integrador que no use Svelte.
const bundle = readFileSync(
  'packages/tess-web-component/dist/tess.global.js',
  'utf8',
);

const forbidden = [
  ['Svelte', /svelte/i],
  ['URL de Supabase', /supabase\.co/i],
  ['localhost', /localhost:\d+/],
  ['clave JWT', /eyJhbGciOi/],
];

const found = forbidden.filter(([, pattern]) => pattern.test(bundle));

if (found.length > 0) {
  console.error(
    'FALLO: el bundle contiene:',
    found.map(([name]) => name).join(', '),
  );
  process.exit(1);
}

console.log(
  `OK: tess.global.js limpio (${(bundle.length / 1024).toFixed(1)} kB)`,
);
```

- [ ] **Step 2: Añadir el script del gate**

Añadir a `scripts` de `package.json` raíz:

```json
    "gate:f1": "pnpm build && pnpm test && pnpm typecheck && pnpm lint && node scripts/check-bundle.mjs"
```

- [ ] **Step 3: Ejecutar el gate automático**

Run: `pnpm gate:f1`
Expected: los cuatro comandos en verde y `OK: tess.global.js limpio`.

- [ ] **Step 4: Verificar los paquetes publicables**

Run:

```bash
for pkg in tess-types tess-core tess-rive tess-client tess-web-component tess-svelte; do
  pnpm --filter @teams4soft/$pkg exec npm pack --pack-destination /tmp/tess-tarballs
  pnpm --filter @teams4soft/$pkg exec publint
done
```

Expected: seis tarballs en `/tmp/tess-tarballs`, cada uno con `dist/` y `README.md`; `tess-rive` incluye además `assets/teams4soft-tess.riv`; `publint` sin errores en ninguno.

Si `publint` falta en algún paquete, añadirlo con `"publint": "catalog:"` a sus `devDependencies` (ya está en el catálogo).

- [ ] **Step 5: Consumir el paquete construido desde fuera del workspace**

La spec exige que una demo limpia instale el paquete **construido**, no el
workspace. Es lo único que detecta un `exports` mal declarado o una
dependencia que solo resolvía por el enlace de pnpm.

```bash
mkdir -p /tmp/tess-consumer && cd /tmp/tess-consumer
npm init -y
npm install /tmp/tess-tarballs/teams4soft-tess-web-component-0.0.0.tgz
cat > check.mjs <<'EOF'
import { TAG_NAME } from '@teams4soft/tess-web-component';
if (TAG_NAME !== 'teams4soft-assistant') {
  throw new Error(`TAG_NAME inesperado: ${TAG_NAME}`);
}
console.log('OK: el paquete construido resuelve fuera del workspace');
EOF
node check.mjs
```

Expected: `OK: el paquete construido resuelve fuera del workspace`. Un fallo
aquí con `ERR_MODULE_NOT_FOUND` significa que una dependencia `workspace:*`
no se declaró bien, no que el código esté mal.

Además, servir `dist/tess.global.js` en un HTML plano y comprobar que
`<teams4soft-assistant>` se monta sin ningún bundler de por medio:

```bash
cd /c/Users/DELL/Desktop/code/herramientas/tess/packages/tess-web-component
npx --yes serve dist -l 4173
```

Abrir un HTML con `<script src="http://localhost:4173/tess.global.js"></script>`
y `<teams4soft-assistant></teams4soft-assistant>`: el launcher debe aparecer.

- [ ] **Step 6: Probar el fallback de carga**

En la demo, cambiar temporalmente el `src` del `.riv` a una ruta inexistente y confirmar que aparece el degradado CSS y se emite `tess:error` con `code: "rive-load"`. Revertir el cambio después.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-bundle.mjs package.json
git commit -m "chore: script de gate de Fase 1 con verificación del bundle"
```

---

## Resumen de tareas

| #   | Tarea                         | Entregable verificable                                     |
| --- | ----------------------------- | ---------------------------------------------------------- |
| 1   | `tess-types`                  | `RequestedState`, tipos del componente y `TessClientLike`  |
| 2   | `tess-core` store             | snapshot, suscripción, destroy inerte                      |
| 3   | `tess-core` transitorios      | `success`/`error` vuelven a `idle` sin pisar interacciones |
| 4   | `tess-core` entorno           | offline como override, reduced-motion                      |
| 5   | `tess-rive` traducción        | estado → booleanos y triggers                              |
| 6   | `tess-rive` ciclo de vida     | pausa en viewport, resize, destroy completo                |
| 7   | `tess-web-component` launcher | shadow DOM, atributos, fallback CSS                        |
| 8   | `tess-web-component` diálogo  | `show()`, Escape, foco                                     |
| 9   | `tess-client` noop            | costura con F2 congelada                                   |
| 10  | `tess-svelte`                 | wrapper con `@sveltejs/package`                            |
| 11  | demo                          | panel de pruebas                                           |
| 12  | gate                          | `pnpm gate:f1`, `npm pack`, fallback                       |
