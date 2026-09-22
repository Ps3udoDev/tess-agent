import { describe, expect, it, vi } from 'vitest';
import { persistirSecciones } from './persist.js';
import { sanearRazon } from './claim.js';

const documento = {
  id: 'doc-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  title: 'Doc',
  mimeType: 'text/plain',
  storageBucket: 'tess-documents',
  storagePath: 'org-1/proj-1/doc-1/a.txt',
};

const chunks = [{ ordinal: 0, content: 'uno', tokenCount: 1, headingPath: [] }];

/** Un doble mínimo de supabase-js con lo que persist.ts usa. */
function clienteFalso(overrides: Record<string, unknown> = {}) {
  const secciones = [{ id: 'sec-1', ordinal: 0 }];
  return {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      insert: vi.fn(() => ({
        select: vi.fn(async () => ({ data: secciones, error: null })),
      })),
      ...overrides,
    })),
  } as never;
}

describe('persistirSecciones', () => {
  it('rechaza un vector de dimensión equivocada ANTES de insertar', async () => {
    // La última barrera antes de la columna vector(1536). Si llega aquí un
    // vector corto, el insert lo rechazaría a mitad de la ingesta y dejaría el
    // documento con secciones sin embeddings.
    await expect(
      persistirSecciones({
        client: clienteFalso(),
        documento,
        chunks,
        vectores: [new Array(768).fill(0.1)],
        model: 'openai/text-embedding-3-small',
        dimensions: 1536,
      }),
    ).rejects.toThrow(/1536/);
  });

  it('rechaza si hay menos vectores que secciones', async () => {
    await expect(
      persistirSecciones({
        client: clienteFalso(),
        documento,
        chunks: [
          ...chunks,
          { ordinal: 1, content: 'dos', tokenCount: 1, headingPath: [] },
        ],
        vectores: [new Array(1536).fill(0.1)],
        model: 'm',
        dimensions: 1536,
      }),
    ).rejects.toThrow(/no coincide/);
  });

  it('cero secciones no intenta insertar nada', async () => {
    const client = clienteFalso();
    const escritas = await persistirSecciones({
      client,
      documento,
      chunks: [],
      vectores: [],
      model: 'm',
      dimensions: 1536,
    });

    expect(escritas).toBe(0);
  });
});

describe('sanearRazon', () => {
  it('recorta a una línea', () => {
    expect(sanearRazon(new Error('primera\nsegunda'))).toBe('primera');
  });

  it('borra rutas de Windows y de contenedor', () => {
    expect(sanearRazon(new Error('falló en C:\\Users\\x\\app.js'))).toContain(
      '<ruta>',
    );
    expect(sanearRazon(new Error('falló en /app/dist/main.js'))).toContain(
      '<ruta>',
    );
  });

  it('acota la longitud', () => {
    expect(sanearRazon(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(
      300,
    );
  });
});
