import type { FastifyInstance } from 'fastify';
import { createConversationRequestSchema } from '@teams4soft/tess-types/api';
import { resolveProject } from '../domain/conversations/resolve-project.js';

interface ProjectParams {
  projectId: string;
}

interface MessagesParams extends ProjectParams {
  conversationId: string;
}

export async function conversationsRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: ProjectParams }>(
    '/v1/projects/:projectId/conversations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = createConversationRequestSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'Cuerpo inválido.',
          retryable: false,
        });
      }

      const client = app.userClient(request.auth.token);
      const proyecto = await resolveProject(client, request.params.projectId);

      if (!proyecto) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      const { data, error } = await client
        .from('conversations')
        .insert({
          organization_id: proyecto.organizationId,
          project_id: proyecto.projectId,
          user_id: request.auth.userId,
          locale: parsed.data.locale ?? 'es-MX',
        })
        .select('id')
        .single();

      if (error || !data) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      return reply.code(201).send({ conversationId: data.id });
    },
  );

  app.get<{ Params: MessagesParams }>(
    '/v1/projects/:projectId/conversations/:conversationId/messages',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const client = app.userClient(request.auth.token);

      // RLS decide qué ve quien pregunta. Se filtra `role` aquí porque
      // `system` y `tool` son turnos internos que el navegador no debe ver.
      const { data, error } = await client
        .from('messages')
        .select('id, role, content, created_at, metadata')
        .eq('conversation_id', request.params.conversationId)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Conversación no disponible.',
          retryable: false,
        });
      }

      return reply.send(
        (data ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
          ...((m.metadata as Record<string, unknown>)?.incomplete ? { incomplete: true } : {}),
        })),
      );
    },
  );
}
