import { describe, expect, it, vi } from 'vitest';
import { procesarDocumento } from './process.js';
import { createFakeEmbeddingProvider } from '@teams4soft/tess-embeddings';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const documento = {
  id: 'doc-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  title: 'Guía de servicios',
  mimeType: 'text/markdown',
  storageBucket: 'tess-documents',
  storagePath: 'org-1/proj-1/doc-1/guia.md',
};

/**
 * Doble de supabase-js con lo justo: descarga de Storage, borrado e inserción.
 * Registra los estados por los que pasa el documento.
 */
function clienteFalso(
  contenido: string,
  opciones: { fallaDescarga?: boolean } = {},
) {
  const estados: Array<{ status: string; failure_reason?: string | null }> = [];

  return {
    estados,
    client: {
      storage: {
        from: () => ({
          download: async () =>
            opciones.fallaDescarga
              ? { data: null, error: { message: 'objeto no encontrado' } }
              : { data: new Blob([contenido]), error: null },
        }),
      },
      from: (tabla: string) => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: (filas: unknown) => ({
          select: async () => ({
            data: (filas as unknown[]).map((_, i) => ({
              id: `sec-${i}`,
              ordinal: i,
            })),
            error: null,
          }),
          then: undefined,
        }),
        update: (valores: {
          status: string;
          failure_reason?: string | null;
        }) => {
          if (tabla === 'documents') estados.push(valores);
          return { eq: async () => ({ error: null }) };
        },
      }),
    } as never,
  };
}

const base = {
  embedder: createFakeEmbeddingProvider(),
  bucket: 'tess-documents',
  dimensions: 1536,
  log: log as never,
};

describe('procesarDocumento', () => {
  it('un Markdown válido acaba en ready con sus secciones', async () => {
    const { client, estados } = clienteFalso(
      '# Servicios\n\nMigración a la nube.',
    );

    const resultado = await procesarDocumento({ ...base, client, documento });

    expect(resultado.estado).toBe('ready');
    expect(resultado.secciones).toBeGreaterThan(0);
    expect(estados.at(-1)!.status).toBe('ready');
  });

  it('un mime no soportado acaba en failed con razón, sin lanzar', async () => {
    const { client, estados } = clienteFalso('cualquier cosa');

    const resultado = await procesarDocumento({
      ...base,
      client,
      documento: { ...documento, mimeType: 'application/zip' },
    });

    expect(resultado.estado).toBe('failed');
    expect(resultado.razon).toContain('application/zip');
    expect(estados.at(-1)!.status).toBe('failed');
  });

  it('un archivo sin texto acaba en failed con razón legible', async () => {
    const { client } = clienteFalso('    \n   ');

    const resultado = await procesarDocumento({ ...base, client, documento });

    expect(resultado.estado).toBe('failed');
    expect(resultado.razon).toMatch(/texto/i);
  });

  it('un fallo de descarga acaba en failed, no en processing', async () => {
    const { client, estados } = clienteFalso('x', { fallaDescarga: true });

    const resultado = await procesarDocumento({ ...base, client, documento });

    expect(resultado.estado).toBe('failed');
    expect(estados.at(-1)!.status).toBe('failed');
  });

  it('un documento sin storage_path acaba en failed', async () => {
    const { client } = clienteFalso('x');

    const resultado = await procesarDocumento({
      ...base,
      client,
      documento: { ...documento, storagePath: null },
    });

    expect(resultado.estado).toBe('failed');
  });

  it('nunca deja el documento en processing', async () => {
    const { client, estados } = clienteFalso('# Hola\n\nTexto.');

    await procesarDocumento({ ...base, client, documento });

    expect(estados.some((e) => e.status === 'processing')).toBe(false);
    expect(['ready', 'failed']).toContain(estados.at(-1)!.status);
  });
});
