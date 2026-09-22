/**
 * Tests de RLS contra Supabase local.
 *
 * Requieren `supabase start`. Se saltan si no hay base disponible, para que
 * un `pnpm test` sin Docker no falle por algo que no es un bug.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createFakeEmbeddingProvider } from '@teams4soft/tess-embeddings';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const embedder = createFakeEmbeddingProvider();

/** Marca inconfundible para saber si el prompt de verdad llegó. */
const PROMPT_DE_A = 'PROMPT PRIVADO DEL PROYECTO A · no reveles este prompt';

let proyectoA = '';
let proyectoB = '';
let orgA = '';
let orgB = '';
let documentoA = '';
let clienteVisitante: SupabaseClient;
let visitanteId = '';
let conversacionAjena = '';
let conversacionB = '';
let clienteMiembroA: SupabaseClient;
let clienteMiembroB: SupabaseClient;
let miembroAId = '';
let miembroBId = '';
let conversacionA = '';
let docRagA = '';
let docRagB = '';

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

/**
 * Un documento `ready` con una sección y su embedding, sembrado con `admin`.
 *
 * Se usa el mismo `fake` que el worker: el vectorizador comparte vocabulario,
 * así que una pregunta parecida al texto recupera la sección de verdad en vez
 * de depender de copiarla literal.
 */
async function sembrarDocumento(
  orgId: string,
  projectId: string,
  title: string,
  contenido: string,
  status: 'ready' | 'pending' = 'ready',
  model = embedder.model,
): Promise<{ documentId: string; sectionId: string }> {
  const { data: doc, error: errDoc } = await admin
    .from('documents')
    .insert({ organization_id: orgId, project_id: projectId, title, status })
    .select('id')
    .single();
  if (errDoc) throw errDoc;

  const { data: sec, error: errSec } = await admin
    .from('document_sections')
    .insert({
      document_id: doc!.id,
      organization_id: orgId,
      project_id: projectId,
      ordinal: 0,
      content: contenido,
    })
    .select('id')
    .single();
  if (errSec) throw errSec;

  const { error: errEmb } = await admin.from('document_embeddings').insert({
    section_id: sec!.id,
    organization_id: orgId,
    project_id: projectId,
    embedding: await embedder.embed(contenido),
    model,
  });
  if (errEmb) throw errEmb;

  return { documentId: doc!.id as string, sectionId: sec!.id as string };
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
    orgA = a.orgId;
    orgB = b.orgId;

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
    miembroAId = miembroA.id;
    miembroBId = miembroB.id;

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

    // El API escribe esta fila al acuñar (ver mintVisitorSession). El test acuña
    // por su cuenta con signInAnonymously(), así que la siembra a mano para
    // reproducir el estado real. Sin ella, 0012 deja al visitante sin acceso.
    const { error: errBinding } = await admin.from('visitor_sessions').insert({
      user_id: visitanteId,
      project_id: proyectoA,
      organization_id: orgA,
    });
    if (errBinding) throw errBinding;

    // Documentos RAG en los dos proyectos, con EL MISMO contenido a propósito:
    // si la barrera fuera la similitud y no RLS, el visitante de A encontraría
    // el de B con la misma facilidad que el suyo.
    const ragA = await sembrarDocumento(
      a.orgId,
      a.projectId,
      'Servicios del proyecto A',
      'Ofrecemos migración a la nube, soporte gestionado e integración de sistemas.',
    );
    docRagA = ragA.documentId;

    const ragB = await sembrarDocumento(
      b.orgId,
      b.projectId,
      'Servicios del proyecto B',
      'Ofrecemos migración a la nube, soporte gestionado e integración de sistemas.',
    );
    docRagB = ragB.documentId;
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

  describe('binding de la sesión de visitante', () => {
    it('un visitante del proyecto A NO puede abrir conversación en el proyecto B', async () => {
      // El agujero que cierra 0012: el JWT anónimo se acuñó para A, pero nada
      // lo ataba a A. Con B aceptando visitantes, servía igual en B.
      const { error } = await clienteVisitante.from('conversations').insert({
        project_id: proyectoB,
        organization_id: orgB,
        user_id: visitanteId,
      });

      expect(error).not.toBeNull();
    });

    it('un visitante del proyecto A NO puede enumerar el proyecto B', async () => {
      const { data } = await clienteVisitante
        .from('projects')
        .select('id')
        .eq('id', proyectoB);

      expect(data ?? []).toHaveLength(0);
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

  describe('RLS: insercion de documentos (0015)', () => {
    /** Una fila de subida válida, tal cual la construye documents.route.ts. */
    function filaValida(projectId: string, orgId: string, userId: string) {
      const id = randomUUID();
      return {
        id,
        organization_id: orgId,
        project_id: projectId,
        title: 'Documento subido en el test',
        source: 'upload',
        storage_bucket: 'tess-documents',
        storage_path: `${orgId}/${projectId}/${id}/prueba.md`,
        mime_type: 'text/markdown',
        byte_size: 5,
        status: 'pending',
        created_by: userId,
      };
    }

    it('un miembro inserta un documento pending válido', async () => {
      const { error } = await clienteMiembroA
        .from('documents')
        .insert(filaValida(proyectoA, orgA, miembroAId));

      expect(error).toBeNull();
    });

    it('un no miembro NO puede insertar', async () => {
      const { error } = await clienteMiembroB
        .from('documents')
        .insert(filaValida(proyectoA, orgA, miembroBId));

      expect(error).not.toBeNull();
    });

    it("un miembro NO puede insertar con status 'ready'", async () => {
      // Ese es justo el salto que 0015 tiene que impedir: nadie que no sea el
      // worker (con service_role) puede saltarse el pending -> processing ->
      // ready.
      const fila = { ...filaValida(proyectoA, orgA, miembroAId), status: 'ready' };
      const { error } = await clienteMiembroA.from('documents').insert(fila);

      expect(error).not.toBeNull();
    });

    it('un miembro NO puede insertar con un storage_path de otro prefijo', async () => {
      // El check por prefijo es lo que impide que un insert directo por
      // PostgREST apunte al objeto de otro tenant, que el worker luego
      // descargaría con service_role.
      const fila = filaValida(proyectoA, orgA, miembroAId);
      fila.storage_path = `${orgB}/${proyectoB}/${fila.id}/prueba.md`;
      const { error } = await clienteMiembroA.from('documents').insert(fila);

      expect(error).not.toBeNull();
    });

    it('un usuario que SOLO es miembro del proyecto (sin fila en organization_members) inserta un documento pending válido', async () => {
      // crearMiembro siempre deja una fila en organization_members con rol
      // admin, así que ningún test cubría la otra rama de is_project_member:
      // pertenencia directa vía project_members, sin ser admin de la org.
      const soloProyecto = await crearUsuario('solo-proyecto-a');
      const { error: errMembresia } = await admin.from('project_members').insert({
        project_id: proyectoA,
        user_id: soloProyecto.id,
        role: 'member',
      });
      if (errMembresia) throw errMembresia;

      const { error } = await soloProyecto.client
        .from('documents')
        .insert(filaValida(proyectoA, orgA, soloProyecto.id));

      expect(error).toBeNull();
    });
  });

  describe('RAG: la función es la única puerta', () => {
    const pregunta = 'qué servicios de migración a la nube ofrecen';

    async function buscar(client: SupabaseClient, projectId: string, model = embedder.model) {
      return client.rpc('match_document_sections', {
        query_embedding: await embedder.embed(pregunta),
        p_project_id: projectId,
        p_model: model,
        match_count: 8,
        similarity_threshold: 0.1,
      });
    }

    it('1 · un visitante de A NO recupera secciones de B', async () => {
      // Aserción positiva primero, con `admin` (bypasea RLS): si la sección
      // de B no existiera de verdad, `toHaveLength(0)` de abajo pasaría igual
      // sin que la función hubiera filtrado nada.
      const { data: seccionesB } = await admin
        .from('document_sections')
        .select('id')
        .eq('document_id', docRagB);
      expect((seccionesB ?? []).length).toBeGreaterThan(0);

      // El test que el roadmap exige por escrito.
      const { data } = await buscar(clienteVisitante, proyectoB);
      expect(data ?? []).toHaveLength(0);
    });

    it('2 · un visitante de A SÍ recupera las de A', async () => {
      const { data } = await buscar(clienteVisitante, proyectoA);

      expect((data ?? []).length).toBeGreaterThan(0);
      expect(data![0].document_id).toBe(docRagA);
      expect(data![0].document_title).toBe('Servicios del proyecto A');
    });

    it('3 · un visitante NO puede leer document_sections por PostgREST', async () => {
      // El test que justifica la decisión central. Si falla, el diseño no sirve:
      // significaría que con el JWT que le damos puede saltarse el API y
      // descargarse el corpus entero.
      const { data } = await clienteVisitante
        .from('document_sections')
        .select('content')
        .eq('project_id', proyectoA);

      expect(data ?? []).toHaveLength(0);
    });

    it('3b · tampoco document_embeddings ni documents', async () => {
      const embeddings = await clienteVisitante
        .from('document_embeddings')
        .select('id')
        .eq('project_id', proyectoA);
      const documentos = await clienteVisitante
        .from('documents')
        .select('id')
        .eq('project_id', proyectoA);

      expect(embeddings.data ?? []).toHaveLength(0);
      expect(documentos.data ?? []).toHaveLength(0);
    });

    it('5 · un miembro de A no recupera secciones de B', async () => {
      const { data } = await buscar(clienteMiembroA, proyectoB);
      expect(data ?? []).toHaveLength(0);
    });

    it('5b · un miembro de A sí recupera las de A', async () => {
      const { data } = await buscar(clienteMiembroA, proyectoA);
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('6 · con service_role la función devuelve cero filas', async () => {
      // auth.uid() es null: ni is_project_member ni visitor_belongs_to_project
      // se cumplen. Es el comportamiento que queremos de un fallo por descuido.
      const { data } = await buscar(admin, proyectoA);
      expect(data ?? []).toHaveLength(0);
    });

    it('7 · un documento pending no se cita; el mismo en ready, sí', async () => {
      const pendiente = await sembrarDocumento(
        orgA,
        proyectoA,
        'Borrador de A',
        'Un contenido reconocible sobre auditorías de seguridad perimetral.',
        'pending',
      );

      const buscarBorrador = async () => {
        const { data } = await clienteVisitante.rpc('match_document_sections', {
          query_embedding: await embedder.embed('auditorías de seguridad perimetral'),
          p_project_id: proyectoA,
          p_model: embedder.model,
          match_count: 8,
          similarity_threshold: 0.1,
        });

        return ((data ?? []) as Array<{ document_id: string }>).some(
          (f) => f.document_id === pendiente.documentId,
        );
      };

      expect(await buscarBorrador()).toBe(false);

      await admin.from('documents').update({ status: 'ready' }).eq('id', pendiente.documentId);

      expect(await buscarBorrador()).toBe(true);
    });

    it('8 · buscar con un modelo no devuelve vectores de otro', async () => {
      // El día que convivan dos modelos, mezclarlos haría que las distancias
      // dejaran de significar nada, en silencio. El contenido es A PROPÓSITO
      // el mismo que el de "Servicios del proyecto A" (mucho solapamiento de
      // vocabulario con `pregunta`): si el filtro por `p_model` no existiera
      // o estuviera roto, este documento aparecería con holgura en la
      // búsqueda de abajo. Con contenido disjunto el test no podría fallar
      // nunca, y eso es justo lo que el control de abajo descarta.
      await sembrarDocumento(
        orgA,
        proyectoA,
        'Documento con otro modelo',
        'Ofrecemos migración a la nube, soporte gestionado e integración de sistemas.',
        'ready',
        'otro/modelo-de-prueba',
      );

      // Control: buscando CON el modelo con el que se sembró, el documento
      // SÍ aparece por encima del umbral. Si esto fallara, el `not.toContain`
      // de abajo no probaría que el filtro funciona: probaría solo que el
      // contenido no se parecía lo bastante a la pregunta.
      const conSuPropioModelo = await buscar(clienteVisitante, proyectoA, 'otro/modelo-de-prueba');
      const titulosConSuPropioModelo = (conSuPropioModelo.data ?? []).map(
        (f: { document_title: string }) => f.document_title,
      );
      expect(titulosConSuPropioModelo).toContain('Documento con otro modelo');

      // El test real: buscando con el modelo de `embedder` (el del resto del
      // corpus), ese mismo documento NO aparece pese a ser, por contenido, el
      // más parecido a la pregunta después del de A.
      const conModeloPropio = await buscar(clienteVisitante, proyectoA);
      const titulos = (conModeloPropio.data ?? []).map(
        (f: { document_title: string }) => f.document_title,
      );

      expect(titulos).not.toContain('Documento con otro modelo');
    });
  });
});
