import { describe, expect, it, vi } from 'vitest';
import { createOpenRouterEmbeddingProvider } from './openrouter.js';

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Un vector de la dimensión pedida, con un valor reconocible. */
function vectorDe(valor: number, dimensiones = 1536): number[] {
  return new Array<number>(dimensiones).fill(valor);
}

const BASE = {
  apiKey: 'sk-or-test',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
};

describe('createOpenRouterEmbeddingProvider', () => {
  it('manda un solo lote con el array de entradas', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({
        data: [
          { index: 0, embedding: vectorDe(0.1) },
          { index: 1, embedding: vectorDe(0.2) },
        ],
      }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await provider.embedMany(['uno', 'dos']);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // La función se llamó una vez, así que los argumentos existen
    const args = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    const url = args[0];
    const init = args[1];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(JSON.parse(init.body as string).input).toEqual([
      'uno',
      'dos',
    ]);
  });

  it('reordena por index y no confía en el orden de llegada', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({
        data: [
          { index: 1, embedding: vectorDe(0.2) },
          { index: 0, embedding: vectorDe(0.1) },
        ],
      }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    const [primero, segundo] = await provider.embedMany(['uno', 'dos']);

    expect(primero![0]).toBeCloseTo(0.1);
    expect(segundo![0]).toBeCloseTo(0.2);
  });

  it('rechaza un vector con dimensión equivocada', async () => {
    // No hay parámetro `dimensions` en la API: se recibe el tamaño nativo del
    // modelo. Si no es el de la columna, hay que enterarse aquí y no en el
    // insert.
    const fetchImpl = vi.fn(async () =>
      respuesta({ data: [{ index: 0, embedding: vectorDe(0.1, 768) }] }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await expect(provider.embed('uno')).rejects.toThrow(/1536/);
  });

  it('rechaza una respuesta con menos vectores que entradas', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({ data: [{ index: 0, embedding: vectorDe(0.1) }] }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await expect(provider.embedMany(['uno', 'dos'])).rejects.toThrow(
      /incompleta/,
    );
  });

  it('manda la credencial y la atribución en las cabeceras', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({ data: [{ index: 0, embedding: vectorDe(0.1) }] }),
    );

    const provider = createOpenRouterEmbeddingProvider({
      ...BASE,
      fetchImpl,
      referer: 'https://tess.example',
      appTitle: 'Tess',
    });
    await provider.embed('uno');

    // La función se llamó una vez, así que el segundo argumento existe
    const args = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    const init = args[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-or-test');
    expect(headers['HTTP-Referer']).toBe('https://tess.example');
    expect(headers['X-Title']).toBe('Tess');
  });

  it('un error HTTP se propaga sin filtrar el texto enviado', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({ error: { message: 'rate limited' } }, 429),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await expect(
      provider.embed('texto confidencial del cliente'),
    ).rejects.toThrow(/429/);
    await expect(
      provider.embed('texto confidencial del cliente'),
    ).rejects.not.toThrow(/confidencial/);
  });

  it('una lista vacía no llama a la red', async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });

    expect(await provider.embedMany([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rechaza un index fuera de rango', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({
        data: [
          { index: 0, embedding: vectorDe(0.1) },
          { index: 5, embedding: vectorDe(0.2) },
        ],
      }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await expect(provider.embedMany(['uno', 'dos'])).rejects.toThrow(
      /incompleta/,
    );
  });

  it('rechaza un index duplicado', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({
        data: [
          { index: 0, embedding: vectorDe(0.1) },
          { index: 0, embedding: vectorDe(0.2) },
        ],
      }),
    );

    const provider = createOpenRouterEmbeddingProvider({ ...BASE, fetchImpl });
    await expect(provider.embedMany(['uno', 'dos'])).rejects.toThrow(
      /incompleta/,
    );
  });
});
