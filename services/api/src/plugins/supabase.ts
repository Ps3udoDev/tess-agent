/**
 * Acceso a Supabase.
 *
 * La regla del servicio: se consulta con el JWT de quien llama, no con
 * service_role. Así RLS evalúa las políticas de 0006 y 0009 como si el usuario
 * consultara directamente.
 *
 * service_role queda reservado a un puñado de operaciones que no pueden ir con
 * el JWT del usuario, y por eso el cliente no se exporta: buscar quién bypasea
 * RLS es leer este archivo, no auditar el servicio entero.
 *
 *   - acuñar la sesión del visitante      · todavía no hay JWT
 *   - escribir visitor_sessions           · el binding, en el mismo acto
 *   - refrescar last_seen_at              · 0012 revoca el grant a anon/authenticated
 *   - insertar el mensaje del asistente   · messages_insert_own solo deja 'user'
 *   - escribir audit_events               · sin política de insert
 *   - leer project_widget_settings        · se lee antes de que exista el JWT
 *   - leer assistant_configs              · el prompt no debe ser legible vía RLS
 *   - subir a Storage                     · bucket privado, lo lee el worker
 */
import fp from 'fastify-plugin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import type { FuentePersistida } from '../rag/citations.js';

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
  /** F3. La columna existe desde 0004 con default '[]'. */
  sources?: FuentePersistida[];
}

export interface AuditEventInput {
  organizationId: string;
  projectId?: string;
  actorId?: string;
  action: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface WidgetSettings {
  project_id: string;
  organization_id: string;
  allowed_origins: string[];
  visitor_access: boolean;
  collect_leads_from_members: boolean;
  greeting: string | null;
}

export interface AssistantConfig {
  system_prompt: string | null;
  locale: string | null;
}

async function plugin(app: FastifyInstance): Promise<void> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = app.env;

  // No se exporta. Solo lo usan las funciones con nombre de abajo.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  });

  app.decorate('userClient', (token: string): SupabaseClient =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );

  /**
   * Acuñar la sesión del visitante y atarla a su proyecto.
   *
   * Por qué service_role: todavía no hay JWT. Es el acto de crearlo, así que
   * no hay credencial de usuario con la que pedirle esto a Supabase.
   *
   * La fila de `visitor_sessions` se escribe ANTES de devolver el token, y el
   * orden no es cosmético: desde 0012 las políticas la exigen, así que un
   * cliente rápido que recibiera el token antes de que exista la fila se
   * comería un 404 en su primera petición.
   *
   * Si la escritura falla se borra el usuario recién creado: un anónimo sin
   * binding no sirve para nada y solo ensucia auth.users.
   */
  app.decorate(
    'mintVisitorSession',
    async (input: {
      projectId: string;
      organizationId: string;
    }): Promise<VisitorSession> => {
      const mintClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await mintClient.auth.signInAnonymously();

      if (error || !data.session || !data.user) {
        throw new Error(`no se pudo acuñar la sesión: ${error?.message ?? 'sin sesión'}`);
      }

      const { error: errBinding } = await serviceClient.from('visitor_sessions').insert({
        user_id: data.user.id,
        project_id: input.projectId,
        organization_id: input.organizationId,
      });

      if (errBinding) {
        await serviceClient.auth.admin.deleteUser(data.user.id).catch(() => undefined);
        throw new Error(`no se pudo atar la sesión al proyecto: ${errBinding.message}`);
      }

      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? 0,
        userId: data.user.id,
      };
    },
  );

  /**
   * `last_seen_at` al refrescar. El binding no cambia: auth.uid() es el mismo.
   *
   * Por qué service_role: aunque el refresco ya trae un JWT de visitante
   * válido, no sirve aquí. 0012 hace `revoke all ... from anon, authenticated`
   * sobre `visitor_sessions`, así que ningún JWT de usuario —ni el del propio
   * visitante— puede escribir esta tabla bajo ninguna circunstancia.
   */
  app.decorate('touchVisitorSession', async (userId: string): Promise<void> => {
    const { error } = await serviceClient
      .from('visitor_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) app.log.error({ err: error.message }, 'fallo al refrescar last_seen_at');
  });

  /**
   * Refresco de la sesión del visitante.
   *
   * NO usa service_role: canjear un refresh token solo necesita la anon key, y
   * el propio token es la prueba de identidad. Vive aquí porque este archivo
   * es el único sitio donde se construyen clientes de Supabase.
   *
   * Devuelve null en vez de lanzar: un refresh token revocado o expirado es un
   * caso esperado, no un fallo del servicio.
   */
  app.decorate(
    'refreshVisitorSession',
    async (refreshToken: string): Promise<VisitorSession | null> => {
      const refreshClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await refreshClient.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data.session || !data.user) return null;

      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? 0,
        userId: data.user.id,
      };
    },
  );

  // messages_insert_own permite solo role = 'user', y eso es deliberado.
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
          sources: input.sources ?? [],
        })
        .select('id')
        .single();

      if (error) throw new Error(`no se pudo persistir la respuesta: ${error.message}`);
      return { id: data.id as string };
    },
  );

  // audit_events no tiene política de insert para authenticated.
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

  // Se lee antes de que exista un JWT, en el acto de acuñarlo.
  app.decorate('readWidgetSettings', async (publicKey: string) => {
    const { data, error } = await serviceClient
      .from('project_widget_settings')
      .select(
        'project_id, organization_id, allowed_origins, visitor_access, collect_leads_from_members, greeting',
      )
      .eq('public_key', publicKey)
      .maybeSingle();

    if (error) app.log.error({ err: error }, 'error en readWidgetSettings');
    return data ?? null;
  });

  app.decorate('readWidgetSettingsByProject', async (projectId: string) => {
    const { data } = await serviceClient
      .from('project_widget_settings')
      .select(
        'project_id, organization_id, allowed_origins, visitor_access, collect_leads_from_members, greeting',
      )
      .eq('project_id', projectId)
      .maybeSingle();

    return data ?? null;
  });

  /**
   * Configuración del asistente para componer el prompt.
   *
   * Se lee con service_role y NO con el cliente del usuario, y tampoco se
   * resuelve con una política de lectura para visitantes, por una razón muy
   * concreta: `assistant_configs.system_prompt` ES el prompt, y el propio
   * prompt ordena no revelarlo. Una política de `select` lo dejaría a la vista
   * de cualquier anónimo vía PostgREST, sin pasar por el API.
   *
   * La única política existente, `assistant_configs_select` de 0006, exige
   * `is_project_member`, que para un visitante es falso: por ese camino la
   * consulta devolvía cero filas y el prompt base —identidad, honestidad,
   * política de idioma— no se aplicaba a nadie que no fuera miembro, en
   * silencio.
   *
   * El valor no sale nunca del servidor: solo viaja al modelo.
   */
  app.decorate(
    'readAssistantConfig',
    async (projectId: string): Promise<AssistantConfig | null> => {
      const { data, error } = await serviceClient
        .from('assistant_configs')
        .select('system_prompt, locale')
        .eq('project_id', projectId)
        .maybeSingle();

      // El prompt nunca se imprime: solo el hecho de que la lectura falló.
      if (error) app.log.error({ err: error.message }, 'error en readAssistantConfig');

      return data ? { system_prompt: data.system_prompt, locale: data.locale } : null;
    },
  );

  /**
   * Subida al bucket privado.
   *
   * Con service_role porque el bucket es privado y el worker tiene que poder
   * leerlo después con la misma credencial. La AUTORIZACIÓN no está aquí: está
   * en el `insert` sobre `documents`, que va con el JWT del miembro y que RLS
   * evalúa con is_project_member. Si ese insert falla, este archivo no se sube.
   */
  app.decorate(
    'subirDocumento',
    async (input: {
      bucket: string;
      path: string;
      contenido: Buffer;
      contentType: string;
    }): Promise<void> => {
      const { error } = await serviceClient.storage
        .from(input.bucket)
        .upload(input.path, input.contenido, {
          contentType: input.contentType,
          upsert: false,
        });

      if (error) throw new Error(`no se pudo subir el documento: ${error.message}`);
    },
  );

  app.decorate('listWidgetOrigins', async (): Promise<string[]> => {
    const { data } = await serviceClient
      .from('project_widget_settings')
      .select('allowed_origins')
      .eq('visitor_access', true);

    return (data ?? []).flatMap((fila) => fila.allowed_origins as string[]);
  });
}

export const supabasePlugin = fp(plugin, { name: 'supabase' });

declare module 'fastify' {
  interface FastifyInstance {
    userClient(token: string): SupabaseClient;
    mintVisitorSession(input: {
      projectId: string;
      organizationId: string;
    }): Promise<VisitorSession>;
    touchVisitorSession(userId: string): Promise<void>;
    refreshVisitorSession(refreshToken: string): Promise<VisitorSession | null>;
    insertAssistantMessage(input: AssistantMessageInput): Promise<{ id: string }>;
    recordAuditEvent(input: AuditEventInput): Promise<void>;
    readWidgetSettings(publicKey: string): Promise<WidgetSettings | null>;
    readWidgetSettingsByProject(projectId: string): Promise<WidgetSettings | null>;
    readAssistantConfig(projectId: string): Promise<AssistantConfig | null>;
    listWidgetOrigins(): Promise<string[]>;
    subirDocumento(input: {
      bucket: string;
      path: string;
      contenido: Buffer;
      contentType: string;
    }): Promise<void>;
  }
}
