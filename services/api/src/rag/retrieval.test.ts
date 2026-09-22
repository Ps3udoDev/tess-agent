import { describe, expect, it, vi } from 'vitest';
import { retrieve } from './retrieval.js';
import { createFakeEmbeddingProvider } from '@teams4soft/tess-embeddings';

const embedder = createFakeEmbeddingProvider();

function clienteConRpc(respuesta: { data?: unknown; error?: { message: string } }) {
  return { rpc: vi.fn(async () => respuesta) } as never;
}

const fila = {
  section_id: 'sec-1',
  document_id: 'doc-1',
  document_title: 'Guía de servicios',
  project_id: 'proj-1',
  ordinal: 0,
  content: 'Ofrecemos migración a la nube.',
  similarity: 0.82,
  metadata: {},
};

const base = {
  projectId: 'proj-1',
  question: '¿qué servicios de migración ofrecen?',
  embedder,
  matchCount: 8,
  threshold: 0.5,
  signal: new AbortController().signal,
};

describe('retrieve', () => {
  it('mapea las filas de la RPC a RetrievedSection', async () => {
    const secciones = await retrieve({
      ...base,
      client: clienteConRpc({ data: [fila] }),
    });

    expect(secciones).toEqual([
      {
        sectionId: 'sec-1',
        documentId: 'doc-1',
        documentTitle: 'Guía de servicios',
        projectId: 'proj-1',
        ordinal: 0,
        content: 'Ofrecemos migración a la nube.',
        similarity: 0.82,
      },
    ]);
  });

  it('RECHAZA una sección de otro proyecto aunque la RPC la devuelva', async () => {
    // Defensa en profundidad: si alguien rompiera el filtro de la función SQL,
    // esto impide que la documentación de un tenant acabe en el prompt de otro.
    const client = clienteConRpc({
      data: [{ ...fila, project_id: 'proj-de-otro-tenant' }],
    });

    await expect(retrieve({ ...base, client })).rejects.toThrow(/otro proyecto/);
  });

  it('pasa el modelo del embedder como p_model', async () => {
    // Sin esto la búsqueda mezclaría vectores de modelos distintos y las
    // distancias dejarían de significar nada.
    const client = clienteConRpc({ data: [] });
    await retrieve({ ...base, client });

    const [nombre, args] = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mock
      .calls[0]!;

    expect(nombre).toBe('match_document_sections');
    expect(args.p_model).toBe(embedder.model);
    expect(args.p_project_id).toBe('proj-1');
    expect(args.match_count).toBe(8);
    expect(args.similarity_threshold).toBe(0.5);
    expect(args.query_embedding).toHaveLength(1536);
  });

  it('cero resultados es una lista vacía, no un error', async () => {
    // Pasa constantemente: un saludo no tiene nada que recuperar.
    expect(await retrieve({ ...base, client: clienteConRpc({ data: [] }) })).toEqual([]);
  });

  it('data null es una lista vacía', async () => {
    expect(await retrieve({ ...base, client: clienteConRpc({ data: null }) })).toEqual([]);
  });

  it('un error de la RPC se propaga para que el llamante pueda degradar', async () => {
    await expect(
      retrieve({
        ...base,
        client: clienteConRpc({ error: { message: 'boom' } }),
      }),
    ).rejects.toThrow(/recuperación/i);
  });

  it('una pregunta vacía no llama a la RPC', async () => {
    const client = clienteConRpc({ data: [] });
    expect(await retrieve({ ...base, question: '   ', client })).toEqual([]);
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });
});
