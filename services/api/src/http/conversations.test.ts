import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

function clienteFalso(proyecto: unknown, conversacion?: unknown) {
  return {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: '33333333-3333-3333-3333-333333333333',
            is_anonymous: true,
          },
        },
        error: null,
      }),
    },
    from(tabla: string) {
      if (tabla === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: proyecto, error: null }),
            }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: conversacion, error: null }),
          }),
        }),
      };
    },
  };
}

async function appConSesion(proyecto: unknown, conversacion?: unknown) {
  const app = await buildApp();
  vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso(proyecto, conversacion) as never);
  // Sustituye la verificación del JWT: el test cubre la ruta, no el plugin.
  app.authenticate = async (request) => {
    request.auth = {
      userId: '33333333-3333-3333-3333-333333333333',
      isAnonymous: true,
      token: 't',
    };
  };
  await app.ready();
  return app;
}

const PROYECTO = '11111111-1111-1111-1111-111111111111';

describe('POST /v1/projects/:projectId/conversations', () => {
  it('devuelve 404 cuando RLS no deja ver el proyecto', async () => {
    const app = await appConSesion(null);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROYECTO}/conversations`,
      headers: { authorization: 'Bearer t' },
      payload: {},
    });

    // 404 y no 403: un 403 confirmaría que el proyecto existe.
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project_not_found');

    await app.close();
  });

  it('crea la conversación con el user_id del JWT', async () => {
    const app = await appConSesion(
      { id: PROYECTO, organization_id: '22222222-2222-2222-2222-222222222222' },
      { id: '44444444-4444-4444-4444-444444444444' },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROYECTO}/conversations`,
      headers: { authorization: 'Bearer t' },
      payload: { locale: 'en-US' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().conversationId).toBe('44444444-4444-4444-4444-444444444444');

    await app.close();
  });
});

describe('GET /v1/projects/:projectId/conversations/:conversationId/messages', () => {
  it('lista mensajes de la conversación formateando incompletos', async () => {
    const app = await buildApp();
    const mensajes = [
      {
        id: '55555555-5555-5555-5555-555555555555',
        role: 'user',
        content: 'hola',
        created_at: '2026-09-19T00:00:00Z',
        metadata: {},
      },
      {
        id: '66666666-6666-6666-6666-666666666666',
        role: 'assistant',
        content: 'hola!',
        created_at: '2026-09-19T00:00:01Z',
        metadata: { incomplete: true },
      },
    ];

    vi.spyOn(app, 'userClient').mockReturnValue({
      auth: {
        getClaims: async () => ({
          data: { claims: { sub: '33333333-3333-3333-3333-333333333333', is_anonymous: true } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: mensajes, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as never);

    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${PROYECTO}/conversations/44444444-4444-4444-4444-444444444444/messages`,
      headers: { authorization: 'Bearer t' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: '55555555-5555-5555-5555-555555555555', content: 'hola' });
    expect(body[1]).toMatchObject({ incomplete: true });

    await app.close();
  });
});
