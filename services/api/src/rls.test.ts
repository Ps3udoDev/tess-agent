/**
 * Tests de RLS contra Supabase local.
 *
 * Requieren `supabase start`. Se saltan si no hay base disponible, para que
 * un `pnpm test` sin Docker no falle por algo que no es un bug.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let proyectoA = '';
let proyectoB = '';
let documentoA = '';
let clienteVisitante: SupabaseClient;
let visitanteId = '';
let conversacionAjena = '';

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

  // Una conversación de OTRO usuario en el proyecto A.
  const { data: otro } = await admin.auth.admin.createUser({
    email: `otro-${Date.now()}@example.com`,
    password: 'password-larga-1234',
    email_confirm: true,
  });

  const { data: conv } = await admin
    .from('conversations')
    .insert({
      organization_id: a.orgId,
      project_id: a.projectId,
      user_id: otro.user!.id,
    })
    .select('id')
    .single();
  conversacionAjena = conv!.id;

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
  it('un visitante del proyecto A no ve conversaciones del proyecto B', async () => {
    const { data } = await clienteVisitante
      .from('conversations')
      .select('id, project_id')
      .eq('project_id', proyectoB);

    expect(data ?? []).toHaveLength(0);
  });
});
