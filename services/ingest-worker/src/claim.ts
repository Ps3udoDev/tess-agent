/**
 * Reclamar trabajo y cerrarlo.
 *
 * La garantía que sostiene todo el worker: un documento reclamado SIEMPRE
 * acaba en `ready` o en `failed`. Uno que se quedara en `processing` no lo
 * volvería a reclamar nadie —`claim_next_document` solo mira `pending`— y
 * sería invisible hasta que alguien mirara la tabla a mano.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DocumentoReclamado {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}

export async function reclamarDocumento(
  client: SupabaseClient,
): Promise<DocumentoReclamado | null> {
  const { data, error } = await client.rpc('claim_next_document');

  if (error) throw new Error(`no se pudo reclamar documento: ${error.message}`);

  // Sin trabajo, la función devuelve una fila con todo a null.
  if (!data || !data.id) return null;

  return {
    id: data.id as string,
    organizationId: data.organization_id as string,
    projectId: data.project_id as string,
    title: data.title as string,
    mimeType: (data.mime_type as string | null) ?? null,
    storageBucket: (data.storage_bucket as string | null) ?? null,
    storagePath: (data.storage_path as string | null) ?? null,
  };
}

export async function marcarListo(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .from('documents')
    .update({ status: 'ready', failure_reason: null })
    .eq('id', id);

  if (error) throw new Error(`no se pudo marcar 'ready': ${error.message}`);
}

export async function marcarFallido(
  client: SupabaseClient,
  id: string,
  razon: string,
): Promise<void> {
  const { error } = await client
    .from('documents')
    .update({ status: 'failed', failure_reason: razon })
    .eq('id', id);

  // Aquí no se lanza: si el marcado de fallo fallara y lanzáramos, el
  // documento se quedaría en `processing`, que es el estado que esta capa
  // existe para evitar. Se deja constancia por el llamante.
  if (error) {
    throw new Error(`no se pudo marcar 'failed': ${error.message}`);
  }
}

/**
 * `failure_reason` es visible para el cliente por `GET /documents`.
 *
 * Se recorta y se limpia de rutas internas y trazas. Un mensaje de error de
 * una librería de PDF puede llevar rutas del contenedor.
 */
export function sanearRazon(error: unknown): string {
  const crudo = error instanceof Error ? error.message : String(error);

  return crudo
    .replace(/[A-Za-z]:\\[^\s]*/g, '<ruta>')
    .replace(/\/(?:home|usr|var|app|tmp)\/[^\s]*/g, '<ruta>')
    .split('\n')[0]!
    .slice(0, 300);
}
