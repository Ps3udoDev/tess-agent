/**
 * Construye la app sin llamar a listen().
 *
 * La separación con main.ts no es cosmética: es lo que permite probar las
 * rutas con app.inject() sin abrir un puerto.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { loadEnv, type TessEnv } from './env.js';
import { healthRoute } from './http/health.route.js';
import { visitorSessionsRoute } from './http/visitor-sessions.route.js';
import { conversationsRoute } from './http/conversations.route.js';
import { leadsRoute } from './http/leads.route.js';
import { messagesRoute } from './http/messages.route.js';
import { documentsRoute } from './http/documents.route.js';
import { supabasePlugin } from './plugins/supabase.js';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { corsPlugin } from './plugins/cors.js';
import { createModelProvider, type ModelProvider } from './agent/model-provider.js';
import { createEmbeddingProvider, type EmbeddingProvider } from '@teams4soft/tess-embeddings';

export interface AppOverrides {
  env?: Partial<TessEnv> | undefined;
  modelProvider?: ModelProvider | undefined;
  embedder?: EmbeddingProvider | undefined;
  /**
   * F3, Tarea 20. Inyectable para que un test pueda capturar lo que se
   * registra —por ejemplo, verificar que la telemetría del turno no lleva
   * contenido de la conversación— sin tocar el nivel de log real.
   */
  logger?: FastifyBaseLogger | undefined;
}

export async function buildApp(overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const env = { ...loadEnv(), ...overrides.env };

  const app = Fastify({
    // Cloud Run y Vercel terminan TLS por delante del contenedor.
    trustProxy: true,
    ...(overrides.logger
      ? { loggerInstance: overrides.logger }
      : { logger: { level: env.LOG_LEVEL } }),
  });

  app.decorate('env', env);
  app.decorate('modelProvider', overrides.modelProvider ?? createModelProvider(env));
  app.decorate('embedder', overrides.embedder ?? createEmbeddingProvider(env));
  await app.register(sensible);
  await app.register(multipart);
  await app.register(supabasePlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(corsPlugin);
  await app.register(healthRoute);
  await app.register(visitorSessionsRoute);
  await app.register(conversationsRoute);
  await app.register(leadsRoute);
  await app.register(messagesRoute);
  await app.register(documentsRoute);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: TessEnv;
    modelProvider: ModelProvider;
    embedder: EmbeddingProvider;
  }
}
