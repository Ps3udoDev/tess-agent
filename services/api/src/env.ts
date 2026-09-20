/**
 * Validación del entorno al arrancar.
 *
 * Falla ruidosamente si falta algo. Un servicio que arranca sin
 * SUPABASE_SERVICE_ROLE_KEY y revienta en la primera petición es peor que uno
 * que no arranca.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  APP_RELEASE: z.string().default('dev'),

  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  MODEL_PROVIDER: z.enum(['fake', 'gateway']).default('fake'),
  MODEL_NAME: z.string().default('anthropic/claude-sonnet-5'),
  AI_GATEWAY_API_KEY: z.string().optional(),

  CORS_ALLOWED_ORIGINS: z.string().default(''),
  VISITOR_SESSION_LIMIT: z.coerce.number().int().default(10),
  VISITOR_SESSION_WINDOW_SECONDS: z.coerce.number().int().default(60),
});

export type TessEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): TessEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const faltan = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Entorno inválido. Revisa: ${faltan}`);
  }

  if (parsed.data.MODEL_PROVIDER === 'gateway' && !parsed.data.AI_GATEWAY_API_KEY) {
    throw new Error('MODEL_PROVIDER=gateway requiere AI_GATEWAY_API_KEY');
  }

  return parsed.data;
}
