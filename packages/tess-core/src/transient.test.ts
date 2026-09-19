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
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    core.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_MS.success);
    expect(seen).not.toHaveBeenCalled();
  });
});
