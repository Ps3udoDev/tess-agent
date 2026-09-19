/**
 * El endpoint de la fase.
 *
 * Orden de persistencia:
 *   1. insertar el mensaje del usuario con SU cliente
 *   2. rellenar el título si la conversación no lo tenía
 *   3. emitir thinking
 *   4. leer historial y componer el prompt
 *   5. arrancar el modelo; AL PRIMER DELTA emitir speaking
 *   6. emitir deltas y acumular
 *   7. persistir la respuesta con service_role y emitir completed
 */
import type { FastifyInstance } from 'fastify';
import { sendMessageRequestSchema } from '@teams4soft/tess-types/api';
import { resolveProject } from '../domain/conversations/resolve-project.js';
import { createSseWriter } from '../domain/assistant-events/sse-writer.js';
import { componerMensajes } from '../agent/prompt.js';
import type { ModelMessage } from '../agent/model-provider.js';

const HEARTBEAT_MS = 15_000;
const TITULO_MAX = 80;

interface Params {
  projectId: string;
  conversationId: string;
}

export async function messagesRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: Params }>(
    '/v1/projects/:projectId/conversations/:conversationId/messages',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = sendMessageRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'Mensaje vacío o demasiado largo.',
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

      const { data: conversacion } = await client
        .from('conversations')
        .select('id, title, locale')
        .eq('id', request.params.conversationId)
        .maybeSingle();

      if (!conversacion) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Conversación no disponible.',
          retryable: false,
        });
      }

      // 1. Mensaje del usuario. Si RLS lo rechaza, 404 sin abrir el stream:
      //    un 403 confirmaría que la conversación existe.
      const { error: errorUsuario } = await client
        .from('messages')
        .insert({
          conversation_id: conversacion.id,
          organization_id: proyecto.organizationId,
          project_id: proyecto.projectId,
          role: 'user',
          content: parsed.data.content,
        })
        .select('id')
        .single();

      if (errorUsuario) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Conversación no disponible.',
          retryable: false,
        });
      }

      // 2. Título, sin llamada al modelo.
      if (!conversacion.title) {
        await client
          .from('conversations')
          .update({ title: parsed.data.content.slice(0, TITULO_MAX) })
          .eq('id', conversacion.id);
      }

      const [{ data: historial }, { data: config }] = await Promise.all([
        client
          .from('messages')
          .select('role, content')
          .eq('conversation_id', conversacion.id)
          .in('role', ['user', 'assistant'])
          .order('created_at', { ascending: true })
          .limit(40),
        client
          .from('assistant_configs')
          .select('system_prompt')
          .eq('project_id', proyecto.projectId)
          .maybeSingle(),
      ]);

      // A partir de aquí el cuerpo es un stream: las cabeceras ya van con 200
      // y un error no puede viajar como código HTTP.
      const writer = createSseWriter(reply.raw);
      const controller = new AbortController();
      const latido = setInterval(() => writer.heartbeat(), HEARTBEAT_MS);

      // Quien cierra la pestaña no debe seguir gastando tokens.
      request.raw.on('close', () => {
        controller.abort();
        clearInterval(latido);
        writer.close();
      });

      const inicio = Date.now();
      let acumulado = '';

      try {
        // 3.
        writer.send({ event: 'assistant.state', data: { state: 'thinking' } });

        const mensajes = componerMensajes({
          systemPrompt: (config?.system_prompt as string | null) ?? null,
          history: ((historial ?? []) as ModelMessage[]).slice(0, -1),
          userMessage: parsed.data.content,
          locale: parsed.data.locale ?? (conversacion.locale as string | undefined),
        });

        // 5 y 6.
        for await (const delta of app.modelProvider.stream({
          messages: mensajes,
          signal: controller.signal,
        })) {
          if (writer.closed) break;

          // `speaking` significa que hay texto saliendo. Antes no.
          if (acumulado === '') {
            writer.send({
              event: 'assistant.state',
              data: { state: 'speaking' },
            });
          }

          acumulado += delta;
          writer.send({ event: 'assistant.delta', data: { text: delta } });
        }

        if (writer.closed) return reply;

        // 7.
        const persistido = await app.insertAssistantMessage({
          conversationId: conversacion.id,
          organizationId: proyecto.organizationId,
          projectId: proyecto.projectId,
          content: acumulado,
          latencyMs: Date.now() - inicio,
        });

        writer.send({
          event: 'assistant.completed',
          data: { messageId: persistido.id },
        });
      } catch (error) {
        // El criterio es que el historial no mienta: si el usuario vio medio
        // párrafo, al recargar debe seguir viéndolo.
        if (acumulado !== '') {
          await app.insertAssistantMessage({
            conversationId: conversacion.id,
            organizationId: proyecto.organizationId,
            projectId: proyecto.projectId,
            content: acumulado,
            incomplete: true,
            latencyMs: Date.now() - inicio,
          });
        }

        // El detalle va al log con el trace_id, no al navegador.
        app.log.error({ err: (error as Error).message }, 'fallo durante el stream');

        writer.send({
          event: 'assistant.error',
          data: {
            code: 'model_unavailable',
            message: 'No pude completar la respuesta.',
            retryable: true,
          },
        });
      } finally {
        clearInterval(latido);
        writer.close();
      }

      return reply;
    },
  );
}
