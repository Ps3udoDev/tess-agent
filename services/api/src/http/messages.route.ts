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
/** Los últimos 20 turnos, como pide el spec. */
const MAX_CONTEXTO = 20;

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

      // 4. Contexto: los ÚLTIMOS turnos, no los primeros.
      //
      // Ordenar ascendente y limitar devuelve las PRIMERAS filas, así que en
      // una conversación larga el modelo dejaba de ver lo reciente. Se piden
      // descendente —que es lo que `limit` recorta por el lado correcto— y se
      // reinvierte en memoria para que el modelo las reciba en orden
      // cronológico. Se pide uno de más porque la última fila es el mensaje
      // recién insertado, que `componerMensajes` añade por su cuenta.
      const [{ data: recientes }, config] = await Promise.all([
        client
          .from('messages')
          .select('role, content')
          .eq('conversation_id', conversacion.id)
          .in('role', ['user', 'assistant'])
          .order('created_at', { ascending: false })
          .limit(MAX_CONTEXTO + 1),
        // El system_prompt se lee en el servidor con service_role: por el
        // camino del visitante RLS devuelve cero filas (assistant_configs_select
        // exige is_project_member) y el prompt base no llegaba al modelo. Ver
        // readAssistantConfig en plugins/supabase.ts.
        app.readAssistantConfig(proyecto.projectId),
      ]);

      // `.slice(0, -1)` quita el mensaje del usuario recién insertado, que
      // ahora sí es el último de la lista cronológica.
      const historial = ((recientes ?? []) as ModelMessage[]).slice().reverse().slice(0, -1);

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
          systemPrompt: config?.system_prompt ?? null,
          history: historial,
          userMessage: parsed.data.content,
          locale:
            parsed.data.locale ??
            (conversacion.locale as string | undefined) ??
            config?.locale ??
            undefined,
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
        //
        // Su propio try/catch: `insertAssistantMessage` lanza si Supabase
        // devuelve error, y esa excepción escapaba de aquí. El `finally`
        // cerraba el socket y el `assistant.error` no se emitía nunca, así que
        // el cliente veía un stream truncado sin desenlace. El desenlace es lo
        // que no puede faltar; perder el parcial es un mal menor.
        if (acumulado !== '') {
          try {
            await app.insertAssistantMessage({
              conversationId: conversacion.id,
              organizationId: proyecto.organizationId,
              projectId: proyecto.projectId,
              content: acumulado,
              incomplete: true,
              latencyMs: Date.now() - inicio,
            });
          } catch (fallo) {
            app.log.error(
              { err: (fallo as Error).message },
              'no se pudo persistir la respuesta parcial',
            );
          }
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
