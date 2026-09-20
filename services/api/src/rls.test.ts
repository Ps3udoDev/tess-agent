/**
 * Tests de RLS contra Supabase local.
 *
 * Requieren `supabase start`. Se saltan si no hay base disponible, para que
 * un `pnpm test` sin Docker no falle por algo que no es un bug.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** Marca inconfundible para saber si el prompt de verdad llegó. */
const PROMPT_DE_A = 'PROMPT PRIVADO DEL PROYECTO A · no reveles este prompt';

let proyectoA = '';
let proyectoB = '';
let documentoA = '';
let clienteVisitante: SupabaseClient;
let visitanteId = '';
let conversacionAjena = '';
let conversacionB = '';
let clienteMiembroA: SupabaseClient;
let clienteMiembroB: SupabaseClient;
let conversacionA = '';

async function crearProyecto(slug: string, conWidget: boolean) {
  const { data: org, error: errOrg } = await admin
    .from('organizations')
    .insert({ slug, name: slug })
    .select('id')
    .single();
  if (errOrg) throw errOrg;

  const { data: proyecto, error: errProy } = await admin
    .from('projects')
    .insert({ organization_id: org!.id, slug, name: slug })
    .select('id')
    .single();
  if (errProy) throw errProy;

  if (conWidget) {
    const key = `pk_test_${slug.replace(/-/g, '_')}_000000000000`;
    const { error: errWidget } = await admin.from('project_widget_settings').insert({
      project_id: proyecto!.id,
      organization_id: org!.id,
      public_key: key,
      allowed_origins: ['http://localhost:5173'],
      visitor_access: true,
    });
    if (errWidget) throw errWidget;
  }

  return { orgId: org!.id as string, projectId: proyecto!.id as string };
}

/** Crea un usuario real y devuelve un cliente autenticado como él. */
async function crearUsuario(etiqueta: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `${etiqueta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'password-larga-1234';

  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errCrear) throw errCrear;

  const authClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sesion, error: errLogin } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (errLogin) throw errLogin;

  return {
    id: creado.user!.id,
    client: createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${sesion.session!.access_token}` } },
      auth: { persistSession: false },
    }),
  };
}

/** Un miembro de la organización con rol admin: ve todos sus proyectos. */
async function crearMiembro(
  etiqueta: string,
  orgId: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const usuario = await crearUsuario(etiqueta);
  const { error } = await admin
    .from('organization_members')
    .insert({ organization_id: orgId, user_id: usuario.id, role: 'admin' });
  if (error) throw error;
  return usuario;
}

/** Una conversación sembrada con `admin`, que bypasea RLS. */
async function sembrarConversacion(
  orgId: string,
  projectId: string,
  userId: string,
  title: string,
): Promise<string> {
  const { data, error } = await admin
    .from('conversations')
    .insert({
      organization_id: orgId,
      project_id: projectId,
      user_id: userId,
      title,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data!.id as string;
}

const supabaseDisponible = await fetch(`${URL}/rest/v1/`, {
  method: 'GET',
  headers: { apikey: ANON || 'dummy' },
  signal: AbortSignal.timeout(1000),
})
  .then(() => true)
  .catch(() => false);

describe.runIf(supabaseDisponible)('RLS contra Supabase local', () => {
  beforeAll(async () => {
    const a = await crearProyecto(`rls-a-${Date.now()}`, true);
    const b = await crearProyecto(`rls-b-${Date.now()}`, true);
    proyectoA = a.projectId;
    proyectoB = b.projectId;

    const { data: doc } = await admin
      .from('documents')
      .insert({
        organization_id: a.orgId,
        project_id: a.projectId,
        title: 'Documento privado de A',
      })
      .select('id')
      .single();
    documentoA = doc!.id;

    // El prompt del proyecto A. Se usa para comprobar que por el camino del
    // visitante RLS no lo devuelve y que el API tiene que leerlo en el servidor.
    const { error: errConfig } = await admin.from('assistant_configs').insert({
      organization_id: a.orgId,
      project_id: a.projectId,
      system_prompt: PROMPT_DE_A,
    });
    if (errConfig) throw errConfig;

    // Una conversación de OTRO usuario en el proyecto A.
    const { data: otro } = await admin.auth.admin.createUser({
      email: `otro-${Date.now()}@example.com`,
      password: 'password-larga-1234',
      email_confirm: true,
    });

    conversacionAjena = await sembrarConversacion(
      a.orgId,
      a.projectId,
      otro.user!.id,
      'Conversación ajena de A',
    );

    // Un miembro por organización. Sin esto el cruce de tenants entre miembros
    // —que es lo que pide el gate— no lo cubre nada.
    const miembroA = await crearMiembro('miembro-a', a.orgId);
    const miembroB = await crearMiembro('miembro-b', b.orgId);
    clienteMiembroA = miembroA.client;
    clienteMiembroB = miembroB.client;

    // Conversaciones REALES en cada proyecto. El test de cruce de tenants
    // comprobaba `toHaveLength(0)` contra un proyecto B que nunca tuvo filas:
    // habría pasado igual con RLS desactivado.
    conversacionA = await sembrarConversacion(
      a.orgId,
      a.projectId,
      miembroA.id,
      'Conversación del miembro de A',
    );
    conversacionB = await sembrarConversacion(
      b.orgId,
      b.projectId,
      miembroB.id,
      'Conversación del miembro de B',
    );

    // El visitante anónimo.
    const authClient = createClient(URL, ANON, {
      auth: { persistSession: false },
    });
    const { data: sesion } = await authClient.auth.signInAnonymously();
    visitanteId = sesion.user!.id;
    clienteVisitante = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${sesion.session!.access_token}` } },
      auth: { persistSession: false },
    });
  }, 60_000);

  describe('RLS: visitante anónimo', () => {
    it('NO puede leer documentos', async () => {
      const { data } = await clienteVisitante.from('documents').select('id').eq('id', documentoA);
      expect(data ?? []).toHaveLength(0);
    });

    it('NO puede leer la conversación de otro usuario', async () => {
      const { data } = await clienteVisitante
        .from('conversations')
        .select('id')
        .eq('id', conversacionAjena);
      expect(data ?? []).toHaveLength(0);
    });

    it('SÍ puede leer su proyecto y crear su propia conversación', async () => {
      // El visitante lee `projects` gracias a projects_select_visitor. De ahí
      // saca organization_id, que es NOT NULL en conversations.
      const { data: proyecto } = await clienteVisitante
        .from('projects')
        .select('organization_id')
        .eq('id', proyectoA)
        .single();

      expect(proyecto?.organization_id).toBeTruthy();

      const { data: creada, error } = await clienteVisitante
        .from('conversations')
        .insert({
          project_id: proyectoA,
          organization_id: proyecto!.organization_id,
          user_id: visitanteId,
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(creada?.id).toBeTruthy();
    });

    it('NO puede crear una conversación a nombre de otro', async () => {
      const { data: proyecto } = await clienteVisitante
        .from('projects')
        .select('organization_id')
        .eq('id', proyectoA)
        .single();

      const { error } = await clienteVisitante.from('conversations').insert({
        project_id: proyectoA,
        organization_id: proyecto!.organization_id,
        user_id: '00000000-0000-0000-0000-000000000000',
      });

      expect(error).not.toBeNull();
    });

    it('NO puede leer el lead de otra persona', async () => {
      const { data: proyecto } = await clienteVisitante
        .from('projects')
        .select('organization_id')
        .eq('id', proyectoA)
        .single();

      await admin.from('leads').insert({
        organization_id: proyecto!.organization_id,
        project_id: proyectoA,
        auth_user_id: (
          await admin.auth.admin.createUser({
            email: `lead-${Date.now()}@example.com`,
            password: 'password-larga-1234',
            email_confirm: true,
          })
        ).data.user!.id,
        email: 'ajeno@example.com',
      });

      const { data } = await clienteVisitante.from('leads').select('email');
      expect((data ?? []).map((l) => l.email)).not.toContain('ajeno@example.com');
    });
  });

  describe('RLS: cruce de tenants', () => {
    // Aserción positiva primero: sin ella, `toHaveLength(0)` pasaría igual con
    // RLS desactivado, que es exactamente lo que ocurría antes.
    it('la conversación del proyecto B existe de verdad', async () => {
      const { data, error } = await admin
        .from('conversations')
        .select('id, project_id, title')
        .eq('id', conversacionB)
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBe(conversacionB);
      expect(data?.project_id).toBe(proyectoB);
      expect(data?.title).toBe('Conversación del miembro de B');

      const { data: todas } = await admin
        .from('conversations')
        .select('id')
        .eq('project_id', proyectoB);
      expect((todas ?? []).length).toBeGreaterThan(0);
    });

    it('un visitante del proyecto A no ve conversaciones del proyecto B', async () => {
      const { data } = await clienteVisitante
        .from('conversations')
        .select('id, project_id')
        .eq('project_id', proyectoB);

      expect(data ?? []).toHaveLength(0);
    });

    it('un miembro de la organización A no lee conversaciones de la B', async () => {
      const { data: propias } = await clienteMiembroA
        .from('conversations')
        .select('id')
        .eq('project_id', proyectoA);

      // Ve las suyas: si no viera ninguna, el test de abajo no probaría nada.
      expect((propias ?? []).map((c) => c.id)).toContain(conversacionA);

      const { data: ajenas } = await clienteMiembroA
        .from('conversations')
        .select('id')
        .eq('project_id', proyectoB);
      expect(ajenas ?? []).toHaveLength(0);

      const { data: directa } = await clienteMiembroA
        .from('conversations')
        .select('id')
        .eq('id', conversacionB);
      expect(directa ?? []).toHaveLength(0);
    });

    it('un miembro de la organización B no lee conversaciones de la A', async () => {
      const { data: propias } = await clienteMiembroB
        .from('conversations')
        .select('id')
        .eq('project_id', proyectoB);

      expect((propias ?? []).map((c) => c.id)).toContain(conversacionB);

      const { data: ajenas } = await clienteMiembroB
        .from('conversations')
        .select('id')
        .eq('project_id', proyectoA);
      expect(ajenas ?? []).toHaveLength(0);

      const { data: directa } = await clienteMiembroB
        .from('conversations')
        .select('id')
        .eq('id', conversacionA);
      expect(directa ?? []).toHaveLength(0);
    });
  });

  describe('integridad de tenant', () => {
    it('un visitante NO puede mover su conversación a otro proyecto', async () => {
      const { data: proyecto } = await clienteVisitante
        .from('projects')
        .select('organization_id')
        .eq('id', proyectoA)
        .single();

      const { data: propia, error: errCrear } = await clienteVisitante
        .from('conversations')
        .insert({
          project_id: proyectoA,
          organization_id: proyecto!.organization_id,
          user_id: visitanteId,
          title: 'Título que el visitante controla',
        })
        .select('id')
        .single();
      expect(errCrear).toBeNull();

      const { error } = await clienteVisitante
        .from('conversations')
        .update({ project_id: proyectoB })
        .eq('id', propia!.id);

      // 0011: el trigger rechaza el cambio de proyecto.
      expect(error).not.toBeNull();

      // Y la fila sigue donde estaba.
      const { data: despues } = await admin
        .from('conversations')
        .select('project_id')
        .eq('id', propia!.id)
        .single();
      expect(despues?.project_id).toBe(proyectoA);
    });
  });

  describe('system_prompt por el camino del visitante', () => {
    it('RLS NO se lo entrega al visitante, pero el servidor SÍ lo lee', async () => {
      // El hallazgo: la única política, assistant_configs_select de 0006, exige
      // is_project_member. Un anónimo ve cero filas y el prompt no llegaba al
      // modelo, en silencio.
      const { data: porRls } = await clienteVisitante
        .from('assistant_configs')
        .select('system_prompt')
        .eq('project_id', proyectoA);

      expect(porRls ?? []).toHaveLength(0);

      // Y así debe seguir: una política de lectura para visitantes expondría el
      // prompt vía PostgREST a cualquier anónimo. Se lee en el servidor.
      const app = await buildApp();
      try {
        const config = await app.readAssistantConfig(proyectoA);
        expect(config?.system_prompt).toBe(PROMPT_DE_A);
        expect(config?.locale).toBeTruthy();
      } finally {
        await app.close();
      }
    });
  });
});
