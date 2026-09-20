/**
 * Validación del entorno del worker.
 *
 * Mismo criterio que el API: falla al arrancar, no en mitad de un documento.
 * Comparte los nombres de variable con el API a propósito — API y worker
 * DEBEN usar el mismo modelo de embeddings, y compartir nombre es la forma
 * más barata de que un despliegue no los desincronice.
 */
import { z } from 'zod';

const DIMENSIONES_DEL_ESQUEMA = 1536;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(8081),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  APP_RELEASE: z.string().default('dev'),

  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  EMBEDDING_PROVIDER: z.enum(['fake', 'openrouter']).default('fake'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default('openai/text-embedding-3-small'),
  OPENROUTER_HTTP_REFERER: z.string().optional(),
  OPENROUTER_APP_TITLE: z.string().default('Tess'),
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .default(DIMENSIONES_DEL_ESQUEMA),

  DOCUMENTS_BUCKET: z.string().default('tess-documents'),
  INGEST_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(
  source: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const faltan = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Entorno del worker inválido. Revisa: ${faltan}`);
  }

  const env = parsed.data;

  if (env.EMBEDDING_PROVIDER === 'openrouter' && !env.OPENROUTER_API_KEY) {
    throw new Error(
      'EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_API_KEY',
    );
  }

  if (env.EMBEDDING_DIMENSIONS !== DIMENSIONES_DEL_ESQUEMA) {
    throw new Error(
      `EMBEDDING_DIMENSIONS debe ser ${DIMENSIONES_DEL_ESQUEMA}: la columna es vector(${DIMENSIONES_DEL_ESQUEMA})`,
    );
  }

  return env;
}
