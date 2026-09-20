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

function clienteConFetch(fetchImpl: typeof fetch) {
  return createTessClient({
    apiUrl: 'https://api.example',
    projectId: PROYECTO,
    publicKey: 'pk_dev_tess_local_0001',
    storage: createMemoryStorage(),
    fetchImpl,
  });
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
