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

  it('mientras está offline, cambiar requested no notifica a los suscriptores', () => {
    const net = fakeConnectivity();
    const core = createTessCore({ connectivity: net.api });
    core.setState('thinking');
    net.set(false);
    const seen = vi.fn();
    core.subscribe(seen);
    core.setState('speaking');
    core.setState('listening');
    expect(seen).not.toHaveBeenCalled();
    expect(core.getSnapshot().requested).toBe('listening');
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
