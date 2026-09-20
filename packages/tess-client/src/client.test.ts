import { describe, expect, it, vi } from 'vitest';
import { createTessClient } from './index.js';
import { createMemoryStorage } from './session.js';

const PROYECTO = '11111111-1111-1111-1111-111111111111';

function respuestaSse(cuerpo: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(cuerpo));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function clienteConFetch(fetchImpl: typeof fetch, storage = createMemoryStorage()) {
  return createTessClient({
    apiUrl: 'https://api.example',
    projectId: PROYECTO,
    publicKey: 'pk_dev_tess_local_0001',
    storage,
    fetchImpl,
  });
}

const CLAVE_SESION = `tess:session:${PROYECTO}`;

/** Una sesión ya caducada: `getToken()` tendrá que renovarla. */
function almacenamientoConSesionCaducada() {
  const storage = createMemoryStorage();
  storage.set(
    CLAVE_SESION,
    JSON.stringify({
      accessToken: 'viejo',
      refreshToken: 'r-viejo',
      expiresAt: 1,
      userId: 'u-original',
      greeting: 'hola',
    }),
  );
  return storage;
}

describe('createTessClient', () => {
  it('falla al construirse sin publicKey ni getToken', () => {
    expect(() => createTessClient({ apiUrl: 'https://api.example', projectId: PROYECTO })).toThrow(
      /publicKey|getToken/,
    );
  });

  it('acuña la sesión antes del primer envío y manda el Bearer', async () => {
    const llamadas: string[] = [];

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      llamadas.push(u);

      if (u.endsWith('/v1/visitor-sessions')) {
        return Response.json({
          accessToken: 'a1',
          refreshToken: 'r1',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u1',
          projectId: PROYECTO,
          greeting: 'hola',
        });
      }

      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer a1');
      return respuestaSse('event: assistant.delta\ndata: {"text":"ok"}\n\n');
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl);
    const eventos = [];

    for await (const e of cliente.sendMessage({
      conversationId: 'c1',
      text: 'hola',
    })) {
      eventos.push(e);
    }

    expect(llamadas[0]).toContain('/v1/visitor-sessions');
    expect(eventos).toEqual([{ event: 'assistant.delta', data: { text: 'ok' } }]);
  });

  it('propaga el AbortSignal al fetch', async () => {
    const controller = new AbortController();
    let señalRecibida: AbortSignal | undefined;

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/v1/visitor-sessions')) {
        return Response.json({
          accessToken: 'a1',
          refreshToken: 'r1',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u1',
          projectId: PROYECTO,
          greeting: null,
        });
      }
      señalRecibida = init?.signal ?? undefined;
      return respuestaSse('event: assistant.completed\ndata: {"messageId":"m1"}\n\n');
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl);

    for await (const _ of cliente.sendMessage({
      conversationId: 'c1',
      text: 'hola',
      signal: controller.signal,
    })) {
      // consumir
    }

    expect(señalRecibida).toBe(controller.signal);
  });

  it('emite assistant.error cuando el servidor responde con un código', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/visitor-sessions')) {
        return Response.json({
          accessToken: 'a1',
          refreshToken: 'r1',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u1',
          projectId: PROYECTO,
          greeting: null,
        });
      }
      return Response.json(
        {
          code: 'rate_limited',
          message: 'Demasiadas peticiones.',
          retryable: true,
        },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl);
    const eventos = [];

    for await (const e of cliente.sendMessage({
      conversationId: 'c1',
      text: 'hola',
    })) {
      eventos.push(e);
    }

    expect(eventos).toEqual([
      {
        event: 'assistant.error',
        data: {
          code: 'rate_limited',
          message: 'Demasiadas peticiones.',
          retryable: true,
        },
      },
    ]);
  });
});

describe('refresco de sesión', () => {
  it('canjea el refresh token y CONSERVA la identidad', async () => {
    const rutas: string[] = [];
    let cuerpoRefresco: unknown;
    let bearerDelMensaje = '';

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      rutas.push(u);

      if (u.endsWith('/v1/visitor-sessions/refresh')) {
        cuerpoRefresco = JSON.parse(String(init?.body));
        return Response.json({
          accessToken: 'nuevo',
          refreshToken: 'r-nuevo',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          // El MISMO usuario: es el punto de todo esto.
          userId: 'u-original',
          projectId: PROYECTO,
          greeting: 'hola',
        });
      }

      bearerDelMensaje = (init?.headers as Record<string, string>).Authorization ?? '';
      return respuestaSse('event: assistant.completed\ndata: {"messageId":"m1"}\n\n');
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl, almacenamientoConSesionCaducada());

    for await (const _ of cliente.sendMessage({ conversationId: 'c1', text: 'hola' })) {
      // consumir
    }

    expect(rutas[0]).toContain('/v1/visitor-sessions/refresh');
    expect(cuerpoRefresco).toEqual({
      refreshToken: 'r-viejo',
      publicKey: 'pk_dev_tess_local_0001',
    });
    expect(bearerDelMensaje).toBe('Bearer nuevo');

    // No se acuñó nada: el auth.uid() —y con él historial y lead— sobrevive.
    expect(rutas.some((r) => r.endsWith('/v1/visitor-sessions'))).toBe(false);
  });

  it('reacuña solo si el refresco falla', async () => {
    const rutas: string[] = [];

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      rutas.push(u);

      if (u.endsWith('/v1/visitor-sessions/refresh')) {
        // Refresh token revocado o expirado del todo.
        return Response.json(
          { code: 'unauthorized', message: 'Sesión expirada.', retryable: false },
          { status: 401 },
        );
      }

      if (u.endsWith('/v1/visitor-sessions')) {
        return Response.json({
          accessToken: 'acunado',
          refreshToken: 'r-acunado',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u-otro',
          projectId: PROYECTO,
          greeting: null,
        });
      }

      return respuestaSse('event: assistant.completed\ndata: {"messageId":"m1"}\n\n');
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl, almacenamientoConSesionCaducada());

    for await (const _ of cliente.sendMessage({ conversationId: 'c1', text: 'hola' })) {
      // consumir
    }

    expect(rutas[0]).toContain('/v1/visitor-sessions/refresh');
    expect(rutas[1]).toMatch(/\/v1\/visitor-sessions$/);
    expect(rutas[2]).toContain('/messages');
  });

  it('un 401 inesperado se reintenta UNA vez tras refrescar', async () => {
    const rutas: string[] = [];
    const bearers: string[] = [];
    let mensajesServidos = 0;

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      rutas.push(u);

      if (u.endsWith('/v1/visitor-sessions')) {
        return Response.json({
          accessToken: 'a1',
          refreshToken: 'r1',
          // Vigente: el 401 llega sin que el cliente lo espere.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u1',
          projectId: PROYECTO,
          greeting: null,
        });
      }

      if (u.endsWith('/v1/visitor-sessions/refresh')) {
        return Response.json({
          accessToken: 'a2',
          refreshToken: 'r2',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          userId: 'u1',
          projectId: PROYECTO,
          greeting: null,
        });
      }

      bearers.push((init?.headers as Record<string, string>).Authorization ?? '');
      mensajesServidos += 1;

      if (mensajesServidos === 1) {
        return Response.json(
          { code: 'unauthorized', message: 'No autorizado.', retryable: false },
          { status: 401 },
        );
      }

      return respuestaSse('event: assistant.completed\ndata: {"messageId":"m1"}\n\n');
    }) as unknown as typeof fetch;

    const cliente = clienteConFetch(fetchImpl);
    const eventos = [];

    for await (const e of cliente.sendMessage({ conversationId: 'c1', text: 'hola' })) {
      eventos.push(e);
    }

    expect(bearers).toEqual(['Bearer a1', 'Bearer a2']);
    expect(rutas.filter((r) => r.endsWith('/v1/visitor-sessions/refresh'))).toHaveLength(1);
    expect(mensajesServidos).toBe(2);
    expect(eventos).toEqual([{ event: 'assistant.completed', data: { messageId: 'm1' } }]);
  });
});
