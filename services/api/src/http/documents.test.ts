import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

const PROYECTO = 'proj-1';
const ORGANIZACION = 'org-1';

/**
 * Construye un cuerpo multipart a mano. Es más largo que usar una librería,
 * pero deja el test sin dependencias y hace visible qué se está enviando.
 */
function multipart(nombre: string, tipo: string, contenido: string) {
  const frontera = '----tessTestBoundary';
  const cuerpo = [
    `--${frontera}`,
    `Content-Disposition: form-data; name="file"; filename="${nombre}"`,
    `Content-Type: ${tipo}`,
    '',
    contenido,
    `--${frontera}--`,
    '',
  ].join('\r\n');

  return {
    payload: cuerpo,
    headers: { 'content-type': `multipart/form-data; boundary=${frontera}` },
  };
}

interface OpcionesApp {
  subidas?: Array<{ path: string }>;
  insertados?: Array<{ organization_id: string }>;
  esMiembro?: boolean;
  documentos?: Array<{
    id: string;
    title: string;
    status: string;
    failure_reason: string | null;
    created_at: string;
  }>;
}

/**
 * Cliente de Supabase falso, siguiendo el patrón de `leads.test.ts` y
 * `messages.test.ts`: resuelve `projects` con RLS (null cuando no hay
 * membresía) y responde a `insert`/`select`/`update` sobre `documents`.
 */
function clienteFalso(opciones: OpcionesApp) {
  return {
    auth: {
      getClaims: async () => ({
        data: {
          claims: { sub: 'user-1', is_anonymous: false },
        },
        error: null,
      }),
    },
    from(tabla: string) {
      if (tabla === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opciones.esMiembro === false
                    ? null
                    : { id: PROYECTO, organization_id: ORGANIZACION },
                error: null,
              }),
            }),
          }),
        };
      }

      // documents
      return {
        insert: async (fila: { organization_id: string }) => {
          opciones.insertados?.push(fila);
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: opciones.documentos ?? [],
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    },
  };
}

async function construirApp(opciones: OpcionesApp = {}) {
  const app = await buildApp();
  vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso(opciones) as never);
  vi.spyOn(app, 'subirDocumento').mockImplementation(async (input) => {
    opciones.subidas?.push({ path: input.path });
  });
  vi.spyOn(app, 'recordAuditEvent').mockResolvedValue(undefined);
  await app.ready();
  return app;
}

async function subir(
  app: Awaited<ReturnType<typeof buildApp>>,
  nombre: string,
  tipo: string,
  extra: { organizationId?: string } = {},
) {
  const cuerpo = multipart(nombre, tipo, 'contenido de prueba');

  return app.inject({
    method: 'POST',
    url: `/v1/projects/${PROYECTO}/documents${
      extra.organizationId ? `?organizationId=${extra.organizationId}` : ''
    }`,
    headers: {
      authorization: 'Bearer token-de-miembro',
      ...cuerpo.headers,
    },
    payload: cuerpo.payload,
  });
}

describe('documentos', () => {
  it('un miembro sube un .md y el documento queda pending', async () => {
    const subidas: Array<{ path: string }> = [];
    const app = await construirApp({ subidas });

    const respuesta = await subir(app, 'guia.md', 'text/markdown');

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json().status).toBe('pending');
    expect(subidas).toHaveLength(1);
  });

  it('la ruta empieza por la organización y lleva el id del documento', async () => {
    // {organization_id}/{project_id}/{document_id}/{nombre}. La organización
    // primero para que la política de Storage se resuelva por prefijo.
    const subidas: Array<{ path: string }> = [];
    const app = await construirApp({ subidas });

    await subir(app, 'guia.md', 'text/markdown');

    expect(subidas[0]!.path).toMatch(/^org-1\/proj-1\/[0-9a-f-]{36}\/guia\.md$/);
  });

  it('rechaza un mime no soportado con 400', async () => {
    const app = await construirApp();
    const respuesta = await subir(app, 'x.zip', 'application/zip');

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().code).toBe('invalid_request');
  });

  it('sanea el nombre y bloquea el path traversal', async () => {
    const subidas: Array<{ path: string }> = [];
    const app = await construirApp({ subidas });

    await subir(app, '../../../etc/passwd', 'text/plain');

    expect(subidas[0]!.path).not.toContain('..');
    expect(subidas[0]!.path).not.toContain('/etc/');
  });

  it('NO acepta organization_id del cliente', async () => {
    // Misma regla que 0008 aplica a leads: un campo de autorización que viene
    // del cliente no es una autorización.
    const insertados: Array<{ organization_id: string }> = [];
    const app = await construirApp({ insertados });

    await subir(app, 'a.txt', 'text/plain', {
      organizationId: 'org-de-la-victima',
    });

    expect(insertados[0]!.organization_id).toBe('org-1');
  });

  it('un no miembro recibe 404, no 403', async () => {
    // Un 403 confirmaría que el proyecto existe.
    const app = await construirApp({ esMiembro: false });
    const respuesta = await subir(app, 'a.txt', 'text/plain');

    expect(respuesta.statusCode).toBe(404);
  });

  it('sin sesión devuelve 401', async () => {
    const app = await construirApp();
    const respuesta = await app.inject({
      method: 'GET',
      url: `/v1/projects/${PROYECTO}/documents`,
    });

    expect(respuesta.statusCode).toBe(401);
  });

  it('el listado devuelve estado y razón del fallo', async () => {
    // Sin esto, un documento que falla es invisible.
    const app = await construirApp({
      documentos: [
        {
          id: 'doc-1',
          title: 'Roto',
          status: 'failed',
          failure_reason: 'formato no soportado: application/zip',
          created_at: '2026-09-19T00:00:00Z',
        },
      ],
    });

    const respuesta = await app.inject({
      method: 'GET',
      url: `/v1/projects/${PROYECTO}/documents`,
      headers: { authorization: 'Bearer token-de-miembro' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().documents[0]).toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('application/zip'),
    });
  });
});
