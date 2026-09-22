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
  opciones: {
    fallaDescarga?: boolean;
    /** El UPDATE a status='ready' devuelve error (para probar marcarListo roto). */
    fallaMarcarListo?: boolean;
    /** El UPDATE a status='failed' devuelve error (para probar marcarFallido roto). */
    fallaMarcarFallido?: boolean;
  } = {},
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
        update: (valores: { status: string; failure_reason?: string | null }) => {
          if (tabla === 'documents') estados.push(valores);

          const falla =
            (valores.status === 'ready' && opciones.fallaMarcarListo) ||
            (valores.status === 'failed' && opciones.fallaMarcarFallido);

          return {
            eq: async () => ({
              error: falla ? { message: 'no se pudo actualizar documents' } : null,
            }),
          };
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
    const { client, estados } = clienteFalso('# Servicios\n\nMigración a la nube.');

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

  it('si marcarFallido también falla tras un error previo, igual RESUELVE failed (nunca lanza)', async () => {
    // El error previo es un mime no soportado; lo que se prueba aquí es que,
    // encima, el UPDATE a status='failed' falla. Es el único camino que deja
    // el documento en `processing`: por eso se resuelve igualmente y se
    // registra con un log distinto, en vez de dejar que la excepción escape.
    const { client, estados } = clienteFalso('cualquier cosa', {
      fallaMarcarFallido: true,
    });
    const antesInfo = log.info.mock.calls.length;
    const antesError = log.error.mock.calls.length;

    const resultado = await procesarDocumento({
      ...base,
      client,
      documento: { ...documento, mimeType: 'application/zip' },
    });

    expect(resultado.estado).toBe('failed');
    expect(resultado.razon).toContain('application/zip');
    // El intento de marcarFallido sí se hace, aunque el UPDATE responda error.
    expect(estados.at(-1)!.status).toBe('failed');

    const llamadasNuevas = [
      ...log.info.mock.calls.slice(antesInfo),
      ...log.error.mock.calls.slice(antesError),
    ];

    expect(
      llamadasNuevas.some(
        ([, msg]) => msg === 'no se pudo marcar el documento como fallido; queda en processing',
      ),
    ).toBe(true);

    // Ningún log de esta llamada lleva contenido del documento, solo ids/razón.
    for (const llamada of llamadasNuevas) {
      expect(JSON.stringify(llamada)).not.toContain('cualquier cosa');
    }
  });

  it('si marcarListo falla DESPUÉS de persistir, degrada a failed y llama a marcarFallido con razón saneada', async () => {
    // persistirSecciones ya escribió las secciones; lo que falla es el UPDATE
    // final a status='ready'. El diseño acepta esta degradación a failed
    // porque reprocesar es idempotente (persistirSecciones borra e inserta).
    const contenidoSecreto = '# Aviso\n\nContenido-Confidencial-No-Debe-Loguearse.';
    const { client, estados } = clienteFalso(contenidoSecreto, {
      fallaMarcarListo: true,
    });
    const antesInfo = log.info.mock.calls.length;
    const antesError = log.error.mock.calls.length;

    const resultado = await procesarDocumento({ ...base, client, documento });

    expect(resultado.estado).toBe('failed');
    expect(resultado.razon).toBeTruthy();
    // Se intentó marcar 'ready' (tras persistir con éxito) y luego 'failed'
    // (dentro del catch, al fallar marcarListo).
    expect(estados.some((e) => e.status === 'ready')).toBe(true);
    expect(estados.at(-1)!.status).toBe('failed');

    const llamadasNuevas = [
      ...log.info.mock.calls.slice(antesInfo),
      ...log.error.mock.calls.slice(antesError),
    ];

    // Se registró el fallo al procesar (marcarListo lanzó dentro del try).
    expect(llamadasNuevas.some(([, msg]) => msg === 'fallo al procesar documento')).toBe(true);

    // Ningún log de esta llamada lleva contenido del documento, solo ids/razón.
    for (const llamada of llamadasNuevas) {
      expect(JSON.stringify(llamada)).not.toContain('Confidencial');
    }
  });
});
