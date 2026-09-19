import { isRequestedState, type AssistantState, type RequestedState } from '@teams4soft/tess-types';

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
