import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, createSessionManager } from './session.js';

const SESION = {
  accessToken: 'a1',
  refreshToken: 'r1',
  expiresAt: 0,
  userId: 'u1',
  greeting: null,
};

function mintFalso(sufijo = '1') {
  return vi.fn(async () => ({
    ...SESION,
    accessToken: `a${sufijo}`,
    refreshToken: `r${sufijo}`,
  }));
}

describe('createSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it('acuña una sesión la primera vez y la reutiliza después', async () => {
    const mint = mintFalso();
    const gestor = createSessionManager({
      storage: createMemoryStorage(),
      key: 'tess:session:p1',
      mint,
      refresh: vi.fn(),
    });

    expect(await gestor.getToken()).toBe('a1');
    expect(await gestor.getToken()).toBe('a1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('recupera la sesión del almacenamiento sin volver a acuñar', async () => {
    const storage = createMemoryStorage();
    storage.set('tess:session:p1', JSON.stringify({ ...SESION, expiresAt: 2_000 }));

    const mint = mintFalso();
    const gestor = createSessionManager({
      storage,
      key: 'tess:session:p1',
      mint,
      refresh: vi.fn(),
    });

    expect(await gestor.getToken()).toBe('a1');
    expect(mint).not.toHaveBeenCalled();
  });

  it('refresca cuando quedan menos de 60 segundos', async () => {
    const storage = createMemoryStorage();
    // expiresAt en segundos: ahora son 1000 s, expira a los 1030 s.
    storage.set('tess:session:p1', JSON.stringify({ ...SESION, expiresAt: 1_030 }));

    const refresh = vi.fn(async () => ({
      ...SESION,
      accessToken: 'a2',
      expiresAt: 5_000,
    }));
    const gestor = createSessionManager({
      storage,
      key: 'tess:session:p1',
      mint: mintFalso(),
      refresh,
    });

    expect(await gestor.getToken()).toBe('a2');
    expect(refresh).toHaveBeenCalledWith('r1');
  });

  it('vuelve a acuñar si el refresco falla', async () => {
    const storage = createMemoryStorage();
    storage.set('tess:session:p1', JSON.stringify({ ...SESION, expiresAt: 1_030 }));

    const mint = mintFalso('9');
    const gestor = createSessionManager({
      storage,
      key: 'tess:session:p1',
      mint,
      refresh: vi.fn(async () => {
        throw new Error('refresh token revocado');
      }),
    });

    expect(await gestor.getToken()).toBe('a9');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('sigue funcionando si el almacenamiento lanza', async () => {
    // Navegación privada o almacenamiento bloqueado.
    const storage = {
      get: () => {
        throw new Error('bloqueado');
      },
      set: () => {
        throw new Error('bloqueado');
      },
      remove: () => {
        throw new Error('bloqueado');
      },
    };

    const gestor = createSessionManager({
      storage,
      key: 'tess:session:p1',
      mint: mintFalso(),
      refresh: vi.fn(),
    });

    expect(await gestor.getToken()).toBe('a1');
  });

  it('clear() descarta la sesión', async () => {
    const mint = mintFalso();
    const gestor = createSessionManager({
      storage: createMemoryStorage(),
      key: 'tess:session:p1',
      mint,
      refresh: vi.fn(),
    });

    await gestor.getToken();
    gestor.clear();
    await gestor.getToken();

    expect(mint).toHaveBeenCalledTimes(2);
  });
});
