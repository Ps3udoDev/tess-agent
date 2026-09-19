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
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ state: 'listening' }));
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
