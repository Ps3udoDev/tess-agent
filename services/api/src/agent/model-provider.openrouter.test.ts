import { describe, expect, it, vi } from 'vitest';
import { createOpenRouterModelProvider } from './model-provider.openrouter.js';
import type { ModelCallMetadata } from './model-provider.js';

function streamSse(sse: string, headers: Record<string, string> = {}): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream', ...headers },
    },
  );
}

const delta = (texto: string, model = 'anthropic/claude-sonnet-5') =>
  `data: ${JSON.stringify({ model, choices: [{ delta: { content: texto } }] })}\n\n`;

const BASE = {
  apiKey: 'sk-or-test',
  model: 'anthropic/claude-sonnet-5',
  maxTokens: 1024,
};
const mensajes = [{ role: 'user' as const, content: 'hola' }];

async function recoger(iterable: AsyncIterable<string>) {
  const trozos: string[] = [];
  for await (const t of iterable) trozos.push(t);
  return trozos.join('');
}

describe('createOpenRouterModelProvider', () => {
  it('emite los deltas de texto en orden', async () => {
    const fetchImpl = vi.fn(async () =>
      streamSse(`${delta('Hola')}${delta(' mundo')}data: [DONE]\n\n`),
    );
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    const texto = await recoger(
      provider.stream({
        messages: mensajes,
        signal: new AbortController().signal,
      }),
    );

    expect(texto).toBe('Hola mundo');
  });

  it('pide stream y manda la política restrictiva de proveedor', async () => {
    // data_collection deny y sin fallbacks: por aquí pasan fragmentos de la
    // documentación privada del cliente.
    // Tipado explícito: sin él, TS infiere los parámetros del mock a partir
    // del callback (sin argumentos) y `mock.calls[0]` queda como tupla vacía.
    const fetchImpl = vi.fn<typeof fetch>(async () => streamSse(`${delta('x')}data: [DONE]\n\n`));
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    await recoger(
      provider.stream({
        messages: mensajes,
        signal: new AbortController().signal,
      }),
    );

    const cuerpo = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);

    expect(cuerpo.stream).toBe(true);
    expect(cuerpo.model).toBe('anthropic/claude-sonnet-5');
    expect(cuerpo.provider).toEqual({
      data_collection: 'deny',
      allow_fallbacks: false,
      require_parameters: true,
    });
  });

  it('manda max_tokens con el valor pasado', async () => {
    // OpenRouter reserva 65536 tokens si no recibe max_tokens, y una clave
    // con límite de gasto rechaza la petición entera. Ver env.ts.
    const fetchImpl = vi.fn<typeof fetch>(async () => streamSse(`${delta('x')}data: [DONE]\n\n`));
    const provider = createOpenRouterModelProvider({
      ...BASE,
      maxTokens: 2048,
      fetchImpl,
    });

    await recoger(
      provider.stream({
        messages: mensajes,
        signal: new AbortController().signal,
      }),
    );

    const cuerpo = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);

    expect(cuerpo.max_tokens).toBe(2048);
  });

  it('informa del modelo real y del id de generación por onMetadata', async () => {
    const fetchImpl = vi.fn(async () =>
      streamSse(`${delta('x', 'openai/gpt-4o')}data: [DONE]\n\n`, {
        'X-Generation-Id': 'gen-abc123',
      }),
    );
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    const vistos: ModelCallMetadata[] = [];
    await recoger(
      provider.stream({
        messages: mensajes,
        signal: new AbortController().signal,
        onMetadata: (m) => vistos.push(m),
      }),
    );

    expect(vistos.at(-1)).toMatchObject({
      provider: 'openrouter',
      requestedModel: 'anthropic/claude-sonnet-5',
      actualModel: 'openai/gpt-4o',
      requestId: 'gen-abc123',
    });
  });

  it('deja de emitir en cuanto se aborta', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () =>
      streamSse(`${delta('uno')}${delta('dos')}${delta('tres')}data: [DONE]\n\n`),
    );
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    const trozos: string[] = [];
    for await (const t of provider.stream({
      messages: mensajes,
      signal: controller.signal,
    })) {
      trozos.push(t);
      controller.abort();
    }

    expect(trozos).toHaveLength(1);
  });

  it('un error HTTP se propaga sin filtrar el prompt', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 502 }));
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    const iterable = provider.stream({
      messages: [{ role: 'user', content: 'dato confidencial del cliente' }],
      signal: new AbortController().signal,
    });

    await expect(recoger(iterable)).rejects.toThrow(/502/);
    await expect(
      recoger(
        provider.stream({
          messages: [{ role: 'user', content: 'dato confidencial del cliente' }],
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.not.toThrow(/confidencial/);
  });

  it('manda la credencial en la cabecera y nunca en la URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => streamSse(`${delta('x')}data: [DONE]\n\n`));
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    await recoger(
      provider.stream({
        messages: mensajes,
        signal: new AbortController().signal,
      }),
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(String(url)).not.toContain('sk-or-test');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-or-test',
    });
  });

  it('una respuesta sin cuerpo da un error claro', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const provider = createOpenRouterModelProvider({ ...BASE, fetchImpl });

    await expect(
      recoger(
        provider.stream({
          messages: mensajes,
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/sin cuerpo/);
  });
});
