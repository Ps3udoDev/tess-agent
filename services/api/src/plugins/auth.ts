/**
 * Autenticación.
 *
 * `getClaims()` verifica la firma EN LOCAL contra el JWKS del proyecto y lo
 * cachea. Importa que sea local: `getUser()` haría una llamada de red por
 * petición y pondría a Supabase en el camino crítico de cada mensaje.
 *
 * Requiere claves de firma asimétricas. Ver el preflight en
 * docs/superpowers/plans/2026-09-19-fase-2-preflight.md
 */
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RequestAuth {
  userId: string;
  isAnonymous: boolean;
  token: string;
}

function extraerBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [esquema, valor] = header.split(' ');
  return esquema?.toLowerCase() === 'bearer' && valor ? valor : undefined;
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', null as unknown as RequestAuth);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extraerBearer(request.headers.authorization);

    if (!token) {
      return reply.code(401).send({
        code: 'unauthorized',
        message: 'Falta la sesión.',
        retryable: false,
      });
    }

    const { data, error } = await app.userClient(token).auth.getClaims(token);

    if (error || !data?.claims?.sub) {
      return reply.code(401).send({
        code: 'unauthorized',
        message: 'Sesión inválida o expirada.',
        retryable: false,
      });
    }

    request.auth = {
      userId: data.claims.sub,
      isAnonymous: data.claims.is_anonymous === true,
      token,
    };
  });
}

export const authPlugin = fp(plugin, {
  name: 'auth',
  dependencies: ['supabase'],
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  }
  interface FastifyRequest {
    auth: RequestAuth;
  }
}
