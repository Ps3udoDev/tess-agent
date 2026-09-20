import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

const PK = 'pk_dev_tess_local_0001';

async function appConMocks(
  overrides: {
    settings?: unknown;
    minted?: number;
    mintVisitorSession?: (input: {
      projectId: string;
      organizationId: string;
    }) => Promise<{ accessToken: string; refreshToken: string; expiresAt: number; userId: string }>;
  } = {},
) {
  const app = await buildApp();
  const minted = { veces: 0 };

  // Sustituye la lectura de project_widget_settings con service_role.
  vi.spyOn(app, 'readWidgetSettings').mockImplementation(async (publicKey: string) =>
    publicKey === PK
      ? ((overrides.settings as never) ?? {
          project_id: '11111111-1111-1111-1111-111111111111',
          organization_id: '22222222-2222-2222-2222-222222222222',
          allowed_origins: ['http://localhost:5173'],
          visitor_access: true,
          collect_leads_from_members: false,
          greeting: 'hola',
        })
      : null,
  );

  vi.spyOn(app, 'mintVisitorSession').mockImplementation(
    overrides.mintVisitorSession ??
      (async () => {
        minted.veces += 1;
        return { accessToken: 'a', refreshToken: 'r', expiresAt: 999, userId: 'u' };
      }),
  );
  vi.spyOn(app, 'refreshVisitorSession').mockImplementation(async (refreshToken: string) =>
    refreshToken === 'r-bueno'
      ? { accessToken: 'a2', refreshToken: 'r2', expiresAt: 1999, userId: 'u' }
      : null,
  );
  vi.spyOn(app, 'recordAuditEvent').mockResolvedValue(undefined);
  vi.spyOn(app, 'listWidgetOrigins').mockResolvedValue(['http://localhost:5173']);

  await app.ready();
  return { app, minted };
}

describe('POST /v1/visitor-sessions', () => {
  it('rechaza un origen no listado y NO acuña usuario', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      headers: { origin: 'https://malicioso.example' },
      payload: { publicKey: PK },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden_origin');
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('rechaza sin cabecera Origin', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      payload: { publicKey: PK },
    });

    expect(res.statusCode).toBe(403);
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('devuelve 404 con una clave desconocida', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      headers: { origin: 'http://localhost:5173' },
      payload: { publicKey: 'pk_no_existe_0000000' },
    });

    expect(res.statusCode).toBe(404);
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('devuelve 404 si el proyecto no acepta visitantes', async () => {
    const { app, minted } = await appConMocks({
      settings: {
        project_id: '11111111-1111-1111-1111-111111111111',
        organization_id: '22222222-2222-2222-2222-222222222222',
        allowed_origins: ['http://localhost:5173'],
        visitor_access: false,
        greeting: null,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      headers: { origin: 'http://localhost:5173' },
      payload: { publicKey: PK },
    });

    expect(res.statusCode).toBe(404);
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('acuña la sesión y devuelve el greeting', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      headers: { origin: 'http://localhost:5173' },
      payload: { publicKey: PK },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ accessToken: 'a', greeting: 'hola' });
    expect(minted.veces).toBe(1);

    await app.close();
  });

  it('escribe el binding del visitante antes de devolver el token', async () => {
    const bindings: Array<{ projectId: string; organizationId: string }> = [];

    const { app } = await appConMocks({
      mintVisitorSession: async (input) => {
        bindings.push(input);
        return { accessToken: 'at', refreshToken: 'rt', expiresAt: 0, userId: 'u-1' };
      },
    });

    const respuesta = await app.inject({
      method: 'POST',
      url: '/v1/visitor-sessions',
      headers: { origin: 'http://localhost:5173' },
      payload: { publicKey: PK },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(bindings).toHaveLength(1);
    // El proyecto sale de la clave pública resuelta en el servidor, nunca del
    // cuerpo de la petición.
    expect(bindings[0]!.projectId).toBe(respuesta.json().projectId);

    await app.close();
  });

  it('corta al superar el rate limit', async () => {
    const { app } = await appConMocks();

    const peticion = () =>
      app.inject({
        method: 'POST',
        url: '/v1/visitor-sessions',
        headers: { origin: 'http://localhost:5173' },
        payload: { publicKey: PK },
      });

    for (let i = 0; i < 10; i += 1) await peticion();
    const excedido = await peticion();

    expect(excedido.statusCode).toBe(429);
    expect(excedido.json().code).toBe('rate_limited');

    await app.close();
  });
});

describe('POST /v1/visitor-sessions/refresh', () => {
  const URL_REFRESH = '/v1/visitor-sessions/refresh';

  it('canjea el token y devuelve la misma forma que el acuñado', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: URL_REFRESH,
      headers: { origin: 'http://localhost:5173' },
      payload: { refreshToken: 'r-bueno', publicKey: PK },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 1999,
      userId: 'u',
      projectId: '11111111-1111-1111-1111-111111111111',
      greeting: 'hola',
    });

    // Lo importante: NO se acuñó un usuario nuevo, así que auth.uid() —y con
    // él el historial y el lead— sobrevive a la expiración.
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('devuelve 401 si el refresh token ya no vale', async () => {
    const { app, minted } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: URL_REFRESH,
      headers: { origin: 'http://localhost:5173' },
      payload: { refreshToken: 'r-revocado', publicKey: PK },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(minted.veces).toBe(0);

    await app.close();
  });

  it('rechaza un origen no listado', async () => {
    const { app } = await appConMocks();

    const res = await app.inject({
      method: 'POST',
      url: URL_REFRESH,
      headers: { origin: 'https://malicioso.example' },
      payload: { refreshToken: 'r-bueno', publicKey: PK },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden_origin');

    await app.close();
  });

  it('devuelve 404 si el proyecto dejó de aceptar visitantes', async () => {
    const { app } = await appConMocks({
      settings: {
        project_id: '11111111-1111-1111-1111-111111111111',
        organization_id: '22222222-2222-2222-2222-222222222222',
        allowed_origins: ['http://localhost:5173'],
        visitor_access: false,
        greeting: null,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: URL_REFRESH,
      headers: { origin: 'http://localhost:5173' },
      payload: { refreshToken: 'r-bueno', publicKey: PK },
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
