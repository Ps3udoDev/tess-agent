/**
 * Resolución de tenant.
 *
 * Se lee la fila de `projects` CON EL CLIENTE DEL USUARIO. Si RLS no devuelve
 * nada, la respuesta es 404 y no 403: un 403 confirmaría que el proyecto
 * existe, y eso es información que no le debemos a quien no tiene acceso.
 *
 * `organization_id` sale de aquí. Nunca del cuerpo de la petición.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedProject {
  projectId: string;
  organizationId: string;
}

export async function resolveProject(
  client: SupabaseClient,
  projectId: string,
): Promise<ResolvedProject | null> {
  const { data } = await client
    .from('projects')
    .select('id, organization_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!data) return null;

  return {
    projectId: data.id as string,
    organizationId: data.organization_id as string,
  };
}
