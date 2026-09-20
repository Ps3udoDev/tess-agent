/**
 * Rate limiting tras una interfaz.
 *
 * El adaptador en memoria vale para local y tests. En Cloud Run cuenta por
 * instancia, así que antes de producción hay que sustituirlo por Redis,
 * Memorystore o equivalente. El límite `anonymous_users` de Supabase sigue
 * siendo la segunda barrera, y esa sí es global.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export function createMemoryRateLimiter(): RateLimiter {
  const ventanas = new Map<string, { contador: number; resetAt: number }>();

  return {
    async consume(key, limit, windowSeconds) {
      const ahora = Date.now();
      const actual = ventanas.get(key);

      if (!actual || actual.resetAt <= ahora) {
        const resetAt = ahora + windowSeconds * 1000;
        ventanas.set(key, { contador: 1, resetAt });
        return { allowed: true, remaining: limit - 1, resetAt };
      }

      if (actual.contador >= limit) {
        return { allowed: false, remaining: 0, resetAt: actual.resetAt };
      }

      actual.contador += 1;
      return {
        allowed: true,
        remaining: limit - actual.contador,
        resetAt: actual.resetAt,
      };
    },
  };
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.decorate('rateLimiter', createMemoryRateLimiter());
}

export const rateLimitPlugin = fp(plugin, { name: 'rate-limit' });

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter: RateLimiter;
  }
}
