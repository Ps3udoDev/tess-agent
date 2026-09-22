/**
 * Subida y listado de documentos.
 *
 * Solo miembros, y la autorización la decide RLS: el `insert` en `documents`
 * va con el JWT del miembro y `documents_insert` de 0006 exige
 * is_project_member. Aquí no hay ningún `if` que decida permisos.
 *
 * El orden importa: primero se inserta la fila (que es lo que RLS autoriza) y
 * solo después se sube el archivo. Al revés, un no miembro conseguiría dejar
 * basura en el bucket antes de que nadie le dijera que no.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { resolveProject } from '../domain/conversations/resolve-project.js';

/**
 * Se redeclara aquí y no se importa del worker: son dos servicios, no una
 * librería. La lista es corta y el gate comprueba que coinciden.
 */
const MIMES_SOPORTADOS = new Set(['application/pdf', 'text/markdown', 'text/plain']);

interface Params {
  projectId: string;
}

/**
 * Nombre seguro.
 *
 * El nombre del cliente NO se usa tal cual. El `document_id` en la ruta ya
 * garantiza unicidad, así que esto solo tiene que impedir que el nombre se
 * salga de su carpeta.
 */
function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[/\\]/).pop() ?? 'documento';
  const limpio = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return limpio.length > 0 ? limpio.slice(0, 120) : 'documento';
}

export async function documentsRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: Params }>(
    '/v1/projects/:projectId/documents',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const client = app.userClient(request.auth.token);
      const proyecto = await resolveProject(client, request.params.projectId);

      // 404 y no 403: un 403 confirmaría que el proyecto existe.
      if (!proyecto) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      const archivo = await request.file({
        limits: { fileSize: app.env.DOCUMENT_MAX_BYTES, files: 1 },
      });

      if (!archivo) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'Falta el archivo.',
          retryable: false,
        });
      }

      const mime = archivo.mimetype.split(';')[0]!.trim().toLowerCase();

      if (!MIMES_SOPORTADOS.has(mime)) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'Formato no soportado. Se aceptan PDF, Markdown y texto plano.',
          retryable: false,
        });
      }

      const contenido = await archivo.toBuffer();

      // `toBuffer` respeta el límite pero no lanza: hay que comprobarlo.
      if (archivo.file.truncated) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'El archivo supera el tamaño máximo.',
          retryable: false,
        });
      }

      const documentId = randomUUID();
      // organization_id sale del proyecto resuelto con RLS, NUNCA del cuerpo.
      const storagePath = `${proyecto.organizationId}/${proyecto.projectId}/${documentId}/${nombreSeguro(archivo.filename)}`;

      // Primero la fila: es lo que RLS autoriza.
      const { error: errInsert } = await client.from('documents').insert({
        id: documentId,
        organization_id: proyecto.organizationId,
        project_id: proyecto.projectId,
        title: nombreSeguro(archivo.filename),
        source: 'upload',
        storage_bucket: app.env.DOCUMENTS_BUCKET,
        storage_path: storagePath,
        mime_type: mime,
        byte_size: contenido.byteLength,
        status: 'pending',
        created_by: request.auth.userId,
      });

      if (errInsert) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      try {
        await app.subirDocumento({
          bucket: app.env.DOCUMENTS_BUCKET,
          path: storagePath,
          contenido,
          contentType: mime,
        });
      } catch (error) {
        // La fila existe y el archivo no: el worker lo reclamaría y fallaría
        // al descargarlo. Se cierra aquí, con una razón clara.
        app.log.error(
          { err: (error as Error).message, documentId },
          'fallo al subir a Storage',
        );

        await client
          .from('documents')
          .update({
            status: 'failed',
            failure_reason: 'no se pudo almacenar el archivo',
          })
          .eq('id', documentId);

        return reply.code(500).send({
          code: 'internal',
          message: 'No se pudo guardar el documento.',
          retryable: true,
        });
      }

      await app.recordAuditEvent({
        organizationId: proyecto.organizationId,
        projectId: proyecto.projectId,
        actorId: request.auth.userId,
        action: 'document.uploaded',
        metadata: {
          documentId,
          mimeType: mime,
          byteSize: contenido.byteLength,
        },
      });

      return reply.code(201).send({ documentId, status: 'pending' });
    },
  );

  /**
   * Sin este listado, un documento que falla es invisible: nadie sabría que su
   * PDF escaneado nunca se va a poder consultar.
   */
  app.get<{ Params: Params }>(
    '/v1/projects/:projectId/documents',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const client = app.userClient(request.auth.token);
      const proyecto = await resolveProject(client, request.params.projectId);

      if (!proyecto) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      // RLS decide qué filas vuelven: documents_select exige is_project_member.
      const { data } = await client
        .from('documents')
        .select('id, title, status, failure_reason, created_at')
        .eq('project_id', proyecto.projectId)
        .order('created_at', { ascending: false });

      return reply.code(200).send({
        documents: (data ?? []).map((d) => ({
          id: d.id as string,
          title: d.title as string,
          status: d.status as string,
          failureReason: (d.failure_reason as string | null) ?? null,
          createdAt: d.created_at as string,
        })),
      });
    },
  );
}
