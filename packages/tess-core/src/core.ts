import { isRequestedState, type AssistantState, type RequestedState } from '@teams4soft/tess-types';
import { browserConnectivity, browserMedia } from './environment.js';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

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
  addEventListener(type: 'change', fn: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', fn: (event: { matches: boolean }) => void): void;
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

const TRANSIENT_STATES = ['success', 'error'] as const;
type TransientState = (typeof TRANSIENT_STATES)[number];

function isTransient(state: RequestedState): state is TransientState {
  return (TRANSIENT_STATES as readonly string[]).includes(state);
}

export function createTessCore(options: TessCoreOptions = {}): TessCore {
  const onError = options.onError ?? (() => {});

  let destroyed = false;
  let requested: RequestedState = options.initialState ?? 'idle';

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

  const transientMs = { ...DEFAULT_TRANSIENT_MS, ...options.transientMs };
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTransient(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

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

  function subscribe(fn: (snapshot: TessSnapshot) => void): () => void {
    if (destroyed) return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    clearTransient();
    unsubscribeConnectivity();
    media?.removeEventListener('change', onMedia);
    listeners.clear();
  }

  return { getSnapshot, setState, subscribe, destroy };
}
