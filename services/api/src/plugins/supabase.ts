/**
 * Acceso a Supabase.
 *
 * La regla del servicio: se consulta con el JWT de quien llama, no con
 * service_role. Así RLS evalúa las políticas de 0006 y 0009 como si el usuario
 * consultara directamente.
 *
 * service_role queda reservado a TRES operaciones, y por eso el cliente no se
 * exporta: buscar quién bypasea RLS es leer este archivo, no auditar el
 * servicio entero.
 */
import fp from 'fastify-plugin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';

export interface VisitorSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

export interface AssistantMessageInput {
  conversationId: string;
  organizationId: string;
  projectId: string;
  content: string;
  incomplete?: boolean;
  latencyMs?: number;
}

export interface AuditEventInput {
  organizationId: string;
  projectId?: string;
  actorId?: string;
  action: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

async function plugin(app: FastifyInstance): Promise<void> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = app.env;

  // No se exporta. Solo lo usan las tres funciones de abajo.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  app.decorate('userClient', (token: string): SupabaseClient =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );

  // 1 de 3: todavía no hay JWT. Es el acto de crearlo.
  app.decorate('mintVisitorSession', async (): Promise<VisitorSession> => {
    const { data, error } = await serviceClient.auth.signInAnonymously();

    if (error || !data.session || !data.user) {
      throw new Error(`no se pudo acuñar la sesión: ${error?.message ?? 'sin sesión'}`);
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? 0,
      userId: data.user.id,
    };
  });

  // 2 de 3: messages_insert_own permite solo role = 'user', y eso es deliberado.
  app.decorate(
    'insertAssistantMessage',
    async (input: AssistantMessageInput): Promise<{ id: string }> => {
      const { data, error } = await serviceClient
        .from('messages')
        .insert({
          conversation_id: input.conversationId,
          organization_id: input.organizationId,
          project_id: input.projectId,
          role: 'assistant',
          content: input.content,
          latency_ms: input.latencyMs ?? null,
          metadata: input.incomplete ? { incomplete: true } : {},
        })
        .select('id')
        .single();

      if (error) throw new Error(`no se pudo persistir la respuesta: ${error.message}`);
      return { id: data.id as string };
    },
  );

  // 3 de 3: audit_events no tiene política de insert para authenticated.
  app.decorate('recordAuditEvent', async (input: AuditEventInput): Promise<void> => {
    // Nunca el texto de la conversación ni contenido documental: IDs y códigos.
    const { error } = await serviceClient.from('audit_events').insert({
      organization_id: input.organizationId,
      project_id: input.projectId ?? null,
      actor_id: input.actorId ?? null,
      action: input.action,
      ip: input.ip ?? null,
      metadata: input.metadata ?? {},
    });

    // Una auditoría que falla no debe tumbar la petición, pero sí quedar en log.
    if (error) app.log.error({ err: error.message }, 'fallo al auditar');
  });
}

export const supabasePlugin = fp(plugin, { name: 'supabase' });

declare module 'fastify' {
  interface FastifyInstance {
    userClient(token: string): SupabaseClient;
    mintVisitorSession(): Promise<VisitorSession>;
    insertAssistantMessage(input: AssistantMessageInput): Promise<{ id: string }>;
    recordAuditEvent(input: AuditEventInput): Promise<void>;
  }
}
