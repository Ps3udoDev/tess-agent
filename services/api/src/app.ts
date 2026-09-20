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
import { visitorSessionsRoute } from './http/visitor-sessions.route.js';
import { conversationsRoute } from './http/conversations.route.js';
import { leadsRoute } from './http/leads.route.js';
import { messagesRoute } from './http/messages.route.js';
import { supabasePlugin } from './plugins/supabase.js';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { corsPlugin } from './plugins/cors.js';
import { createModelProvider, type ModelProvider } from './agent/model-provider.js';

export interface AppOverrides {
  env?: Partial<TessEnv> | undefined;
  modelProvider?: ModelProvider | undefined;
}

export async function buildApp(overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const env = { ...loadEnv(), ...overrides.env };

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // Cloud Run y Vercel terminan TLS por delante del contenedor.
    trustProxy: true,
  });

  app.decorate('env', env);
  app.decorate('modelProvider', overrides.modelProvider ?? createModelProvider(env));
  await app.register(sensible);
  await app.register(supabasePlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(corsPlugin);
  await app.register(healthRoute);
  await app.register(visitorSessionsRoute);
  await app.register(conversationsRoute);
  await app.register(leadsRoute);
  await app.register(messagesRoute);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: TessEnv;
    modelProvider: ModelProvider;
  }
}
