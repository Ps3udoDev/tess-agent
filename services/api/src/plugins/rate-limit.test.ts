import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRateLimiter } from './rate-limit.js';

describe('createMemoryRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('permite hasta el límite y luego rechaza', async () => {
    const limiter = createMemoryRateLimiter();

    for (let i = 0; i < 3; i += 1) {
      const r = await limiter.consume('ip:1.2.3.4', 3, 60);
      expect(r.allowed).toBe(true);
    }

    const excedido = await limiter.consume('ip:1.2.3.4', 3, 60);
    expect(excedido.allowed).toBe(false);
    expect(excedido.remaining).toBe(0);
  });

  it('separa las claves', async () => {
    const limiter = createMemoryRateLimiter();

    await limiter.consume('ip:a', 1, 60);
    const otra = await limiter.consume('ip:b', 1, 60);

    expect(otra.allowed).toBe(true);
  });

  it('reabre la ventana cuando expira', async () => {
    const limiter = createMemoryRateLimiter();

    await limiter.consume('ip:a', 1, 60);
    expect((await limiter.consume('ip:a', 1, 60)).allowed).toBe(false);

    vi.setSystemTime(61_000);
    expect((await limiter.consume('ip:a', 1, 60)).allowed).toBe(true);
  });
});
