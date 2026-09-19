/**
 * Construye la app sin llamar a listen().
 *
 * La separación con main.ts no es cosmética: es lo que permite probar las
 * rutas con app.inject() sin abrir un puerto.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loadEnv, type TessEnv } from './env.js';
import { healthRoute } from './http/health.route.js';
import { supabasePlugin } from './plugins/supabase.js';
import { authPlugin } from './plugins/auth.js';

export interface AppOverrides {
  env?: Partial<TessEnv>;
}

export async function buildApp(overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const env = { ...loadEnv(), ...overrides.env };

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // Cloud Run y Vercel terminan TLS por delante del contenedor.
    trustProxy: true,
  });

  app.decorate('env', env);
  await app.register(sensible);
  await app.register(supabasePlugin);
  await app.register(authPlugin);
  await app.register(healthRoute);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: TessEnv;
  }
}
