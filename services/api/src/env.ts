/**
 * Validación del entorno al arrancar.
 *
 * Falla ruidosamente si falta algo. Un servicio que arranca sin
 * SUPABASE_SERVICE_ROLE_KEY y revienta en la primera petición es peor que uno
 * que no arranca.
 *
 * F3 sustituyó Vercel AI Gateway por OpenRouter, y se llama por REST: no hay
 * ninguna dependencia de IA en el árbol.
 */
import { z } from 'zod';

/**
 * La columna es `vector(1536)` y el índice HNSW está construido sobre ella.
 * Cambiar esto no es configurar: es migrar columna, índice, validaciones y la
 * firma de match_document_sections.
 */
const DIMENSIONES_DEL_ESQUEMA = 1536;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  APP_RELEASE: z.string().default('dev'),

  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  MODEL_PROVIDER: z.enum(['fake', 'openrouter']).default('fake'),
  EMBEDDING_PROVIDER: z.enum(['fake', 'openrouter']).default('fake'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_CHAT_MODEL: z.string().optional(),
  // Sin default: si lo tuviera, EMBEDDING_PROVIDER=openrouter nunca podría
  // fallar por falta de modelo, y esa validación existe a propósito más abajo.
  OPENROUTER_EMBEDDING_MODEL: z.string().optional(),
  // Atribución opcional en el panel de OpenRouter.
  OPENROUTER_HTTP_REFERER: z.string().optional(),
  OPENROUTER_APP_TITLE: z.string().default('Tess'),

  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .default(DIMENSIONES_DEL_ESQUEMA),
  RAG_MATCH_COUNT: z.coerce.number().int().min(1).max(50).default(8),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  DOCUMENTS_BUCKET: z.string().default('tess-documents'),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().default(26_214_400),

  CORS_ALLOWED_ORIGINS: z.string().default(''),
  VISITOR_SESSION_LIMIT: z.coerce.number().int().default(10),
  VISITOR_SESSION_WINDOW_SECONDS: z.coerce.number().int().default(60),
  MESSAGE_LIMIT: z.coerce.number().int().default(30),
  MESSAGE_WINDOW_SECONDS: z.coerce.number().int().default(300),
});

export type TessEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): TessEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const faltan = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Entorno inválido. Revisa: ${faltan}`);
  }

  const env = parsed.data;

  if (env.MODEL_PROVIDER === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error('MODEL_PROVIDER=openrouter requiere OPENROUTER_API_KEY');
    }
    if (!env.OPENROUTER_CHAT_MODEL) {
      throw new Error(
        'MODEL_PROVIDER=openrouter requiere OPENROUTER_CHAT_MODEL',
      );
    }
  }

  if (env.EMBEDDING_PROVIDER === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error(
        'EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_API_KEY',
      );
    }
    if (!env.OPENROUTER_EMBEDDING_MODEL) {
      throw new Error(
        'EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_EMBEDDING_MODEL',
      );
    }
  }

  // Caza solo el error más tonto, pero es gratis: un modelo de chat en el
  // endpoint de embeddings no falla de forma legible.
  if (
    env.OPENROUTER_CHAT_MODEL &&
    env.OPENROUTER_CHAT_MODEL === env.OPENROUTER_EMBEDDING_MODEL
  ) {
    throw new Error(
      'OPENROUTER_CHAT_MODEL debe ser distinto de OPENROUTER_EMBEDDING_MODEL',
    );
  }

  if (env.EMBEDDING_DIMENSIONS !== DIMENSIONES_DEL_ESQUEMA) {
    throw new Error(
      `EMBEDDING_DIMENSIONS debe ser ${DIMENSIONES_DEL_ESQUEMA}: la columna es vector(${DIMENSIONES_DEL_ESQUEMA})`,
    );
  }

  return env;
}
