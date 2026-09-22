/**
 * El único cliente de Supabase del worker.
 *
 * Usa `service_role` siempre, y eso aquí es correcto y no una excepción: el
 * worker no actúa en nombre de ningún usuario. No hay JWT de nadie que
 * reenviar. Escribe secciones y embeddings, que `0006` no concede a
 * `authenticated` justamente porque los escribe este servicio.
 *
 * Como en el API, el cliente se construye en un solo archivo: buscar quién
 * bypasea RLS es leer este módulo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkerEnv } from './env.js';

export function crearClienteServicio(env: WorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
