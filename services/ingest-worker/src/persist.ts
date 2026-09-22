/**
 * Escritura de secciones y embeddings.
 *
 * Idempotente: borra las secciones del documento antes de escribir las nuevas.
 * `document_embeddings` cuelga de `section_id` con `on delete cascade`, así que
 * se van con ellas. Un documento reprocesado no acumula el doble de secciones,
 * y uno que falló a medias no deja huérfanas de la pasada anterior.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Chunk } from './chunk.js';
import type { DocumentoReclamado } from './claim.js';

export interface PersistirInput {
  client: SupabaseClient;
  documento: DocumentoReclamado;
  chunks: Chunk[];
  vectores: number[][];
  model: string;
  dimensions: number;
}

export async function persistirSecciones(input: PersistirInput): Promise<number> {
  const { client, documento, chunks, vectores, model, dimensions } = input;

  if (chunks.length !== vectores.length) {
    throw new Error(
      `el número de vectores no coincide con el de secciones: ${vectores.length} vs ${chunks.length}`,
    );
  }

  // La última barrera antes de la columna vector(1536). Comprobarlo aquí
  // convierte un corpus corrupto en un documento `failed` con razón legible.
  for (const [i, vector] of vectores.entries()) {
    if (vector.length !== dimensions) {
      throw new Error(
        `la sección ${i} tiene ${vector.length} dimensiones; la columna exige ${dimensions}`,
      );
    }
  }

  // Idempotencia. Se borra siempre, incluso con cero secciones nuevas: un
  // documento que antes tenía texto y ahora no debe quedarse sin él.
  const { error: errBorrar } = await client
    .from('document_sections')
    .delete()
    .eq('document_id', documento.id);

  if (errBorrar) throw new Error(`no se pudieron borrar las secciones: ${errBorrar.message}`);

  if (chunks.length === 0) return 0;

  const { data: insertadas, error: errSecciones } = await client
    .from('document_sections')
    .insert(
      chunks.map((c) => ({
        document_id: documento.id,
        organization_id: documento.organizationId,
        project_id: documento.projectId,
        ordinal: c.ordinal,
        content: c.content,
        token_count: c.tokenCount,
        metadata: c.headingPath.length > 0 ? { heading_path: c.headingPath } : {},
      })),
    )
    .select('id, ordinal');

  if (errSecciones) throw new Error(`no se pudieron escribir secciones: ${errSecciones.message}`);

  // El insert no garantiza el orden de vuelta: se mapea por `ordinal`.
  const idPorOrdinal = new Map<number, string>(
    (insertadas ?? []).map((f) => [f.ordinal as number, f.id as string]),
  );

  const { error: errEmbeddings } = await client.from('document_embeddings').insert(
    chunks.map((c, i) => {
      const sectionId = idPorOrdinal.get(c.ordinal);
      if (!sectionId) throw new Error(`falta el id de la sección ${c.ordinal}`);

      return {
        section_id: sectionId,
        organization_id: documento.organizationId,
        project_id: documento.projectId,
        embedding: vectores[i]!,
        model,
      };
    }),
  );

  if (errEmbeddings) {
    throw new Error(`no se pudieron escribir embeddings: ${errEmbeddings.message}`);
  }

  return chunks.length;
}
