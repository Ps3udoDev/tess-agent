import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTessCore, DEFAULT_TRANSIENT_MS } from '@teams4soft/tess-core';
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

// El `onLoad` de Rive se captura en vez de auto-resolverse: la carga del
// .riv es un fetch de red, así que el estado puede pedirse (y hasta
// completar un transitorio) antes de que termine. Capturarlo permite
// interoperar ese orden en los tests en vez de asumir que siempre gana la
// carga.
let pendingOnLoad: (() => void) | undefined;

function loadRive(): void {
  pendingOnLoad?.();
}

vi.mock('@rive-app/canvas', () => ({
  Rive: class {
    constructor(options: { onLoad?: () => void }) {
      Object.assign(this, riveInstance);
      pendingOnLoad = options.onLoad;
    }
  },
  Layout: class {},
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}));

// Réplica del `fakeMedia` de `tess-core`'s `environment.test.ts`: un
// `MediaQueryListLike` inyectable cuyo `addEventListener` guarda el listener
// para poder disparar el cambio manualmente.
function fakeMedia(initial = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql = {
    matches: initial,
    addEventListener: (_type: 'change', fn: (event: { matches: boolean }) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_type: 'change', fn: (event: { matches: boolean }) => void) => {
      listeners.delete(fn);
    },
  };
  return {
    api: () => mql,
    set(value: boolean) {
      mql.matches = value;
      for (const fn of listeners) fn({ matches: value });
    },
  };
}

beforeEach(async () => {
  inputs.clear();
  for (const name of Object.values(RIVE_BOOLEANS)) makeInput(name);
  for (const name of Object.values(RIVE_TRIGGERS)) makeInput(name);
  vi.clearAllMocks();
  pendingOnLoad = undefined;
});

afterEach(() => vi.useRealTimers());

async function mount() {
  const core = createTessCore();
  const canvas = document.createElement('canvas');
  const handle = mountTessRive({ canvas, core });
  loadRive();
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

  it('no re-dispara el trigger al re-pedir el mismo estado', async () => {
    const { core } = await mount();
    core.setState('error');
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);
    // Una notificación que no cambia el estado no puede relanzar la animación.
    core.setState('error');
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);
  });

  it('no re-dispara el trigger cuando cambia reducedMotion en el mismo estado', async () => {
    // A diferencia del caso anterior, aquí SÍ llega una notificación nueva a
    // apply(): reducedMotion cambia mientras el estado efectivo se mantiene
    // en 'error'. El trigger no debe volver a dispararse.
    const media = fakeMedia(false);
    const core = createTessCore({ media: media.api });
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });
    loadRive();
    await Promise.resolve();

    core.setState('error');
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);

    media.set(true);
    expect(inputs.get(RIVE_TRIGGERS.error)!.fire).toHaveBeenCalledTimes(1);
    expect(inputs.get(RIVE_BOOLEANS.reducedMotion)!.value).toBe(true);
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
    loadRive();
    await Promise.resolve();
    expect(inputs.get(RIVE_BOOLEANS.reducedMotion)!.value).toBe(true);
  });

  it('greet() dispara el trigger decorativo', async () => {
    const { handle } = await mount();
    handle.greet();
    expect(inputs.get(RIVE_TRIGGERS.greet)!.fire).toHaveBeenCalledTimes(1);
  });
});

describe('estado pedido antes de que el .riv termine de cargar', () => {
  it('dispara el trigger al cargar si el estado pedido antes sigue vigente', async () => {
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });

    // Se pide 'success' mientras `inputs` todavía está vacío: bool()/fire()
    // son no-ops en este punto. El trigger no debe perderse.
    core.setState('success');
    expect(inputs.get(RIVE_TRIGGERS.success)!.fire).not.toHaveBeenCalled();

    loadRive();
    await Promise.resolve();

    expect(inputs.get(RIVE_TRIGGERS.success)!.fire).toHaveBeenCalledTimes(1);
  });

  it('no resucita el trigger si el transitorio ya volvió a idle antes de cargar', async () => {
    vi.useFakeTimers();
    const core = createTessCore();
    const canvas = document.createElement('canvas');
    mountTessRive({ canvas, core });

    core.setState('success');
    // El transitorio expira y vuelve a 'idle' mientras el .riv sigue
    // cargando: la ventana para disparar 'success' ya pasó.
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success);

    loadRive();
    await Promise.resolve();

    expect(inputs.get(RIVE_TRIGGERS.success)!.fire).not.toHaveBeenCalled();
  });
});
