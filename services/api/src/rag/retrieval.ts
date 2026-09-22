/**
 * Recuperación semántica.
 *
 * Se llama con el cliente del USUARIO, no con service_role. La función SQL es
 * `security definer` pero lee `auth.uid()` para autorizar, así que el JWT de
 * quien pregunta tiene que llegar hasta ella. Llamarla con service_role no
 * daría más resultados: daría cero, porque `auth.uid()` sería null y ni
 * `is_project_member` ni `visitor_belongs_to_project` se cumplirían. Ese es
 * exactamente el comportamiento que queremos de un fallo por descuido.
 *
 * Aquí NO hay ninguna comprobación de permisos en TypeScript, y es
 * deliberado: los permisos de RAG viven en 0013.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '@teams4soft/tess-embeddings';

export interface RetrievedSection {
  sectionId: string;
  documentId: string;
  documentTitle: string;
  /** Redundante con el filtro de la RPC, y a propósito. Ver `retrieve`. */
  projectId: string;
  ordinal: number;
  content: string;
  similarity: number;
}

export interface RetrieveInput {
  /** El del usuario, con SU JWT. */
  client: SupabaseClient;
  projectId: string;
  question: string;
  embedder: EmbeddingProvider;
  matchCount: number;
  threshold: number;
  signal: AbortSignal;
}

interface FilaRpc {
  section_id: string;
  document_id: string;
  document_title: string;
  project_id: string;
  ordinal: number;
  content: string;
  similarity: number;
}

export async function retrieve(
  input: RetrieveInput,
): Promise<RetrievedSection[]> {
  if (input.question.trim().length === 0) return [];

  const embedding = await input.embedder.embed(input.question, input.signal);

  // Quien cerró la pestaña no debe seguir gastando: el embedding ya se pagó,
  // pero la consulta no hace falta.
  if (input.signal.aborted) return [];

  // El array de números viaja tal cual: PostgREST lo convierte al tipo
  // `vector` de la firma. No hace falta serializarlo a '[1,2,...]'.
  const { data, error } = await input.client.rpc('match_document_sections', {
    query_embedding: embedding,
    p_project_id: input.projectId,
    p_model: input.embedder.model,
    match_count: input.matchCount,
    similarity_threshold: input.threshold,
  });

  if (error) {
    // Se lanza para que el handler pueda degradar y auditar. El mensaje no
    // lleva la pregunta.
    throw new Error(`fallo en la recuperación: ${error.message}`);
  }

  const secciones = ((data ?? []) as FilaRpc[]).map((f) => ({
    sectionId: f.section_id,
    documentId: f.document_id,
    documentTitle: f.document_title,
    projectId: f.project_id,
    ordinal: f.ordinal,
    content: f.content,
    similarity: f.similarity,
  }));

  // Defensa en profundidad, en la línea de los triggers de 0010 y 0011: la
  // función SQL ya filtra por proyecto, y aun así se vuelve a comprobar antes
  // de que este texto acabe en un prompt que sale hacia OpenRouter. Si alguien
  // edita la función y rompe el filtro, esto lo caza en vez de mandar la
  // documentación de un tenant al modelo preguntando por otro.
  const ajenas = secciones.filter((s) => s.projectId !== input.projectId);

  if (ajenas.length > 0) {
    throw new Error(
      `la recuperación devolvió ${ajenas.length} sección(es) de otro proyecto`,
    );
  }

  return secciones;
}
