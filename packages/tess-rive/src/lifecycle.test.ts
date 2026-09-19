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

// `onLoadError` se captura en vez de auto-resolverse, igual que el `onLoad`
// de mount.test.ts: así el test decide cuándo "falla" la carga en vez de
// depender de un microtask implícito. Ningún test de este archivo depende de
// que `onLoad` llegue a dispararse, así que no hace falta capturarlo.
let pendingOnLoadError: ((event?: unknown) => void) | undefined;

function failRive(event?: unknown): void {
  pendingOnLoadError?.(event);
}

vi.mock('@rive-app/canvas', () => ({
  Rive: class {
    constructor(options: { onLoadError?: (event?: unknown) => void }) {
      Object.assign(this, riveInstance);
      pendingOnLoadError = options.onLoadError;
    }
  },
  Layout: class {},
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}));

let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
const observerInstances: { disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  observerInstances.length = 0;
  intersectionCallback = undefined;
  pendingOnLoadError = undefined;

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
    // Deben existir ambos observers (viewport y resize) y todos desconectados.
    expect(observerInstances.length).toBe(2);
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

  it('reporta el fallo de carga por onError en vez de lanzar, preservando la causa original', () => {
    const onError = vi.fn();
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    expect(() => mountTessRive({ canvas, core, src: '/no-existe.riv', onError })).not.toThrow();

    const cause = { type: 'loaderror' };
    failRive(cause);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('/no-existe.riv'),
        cause,
      }),
    );
  });

  it('un estado que llega antes de onLoad no rompe', () => {
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });
    // Sin llamar a loadRive(): el mapa de inputs todavía está vacío.
    expect(() => core.setState('thinking')).not.toThrow();
  });
});
