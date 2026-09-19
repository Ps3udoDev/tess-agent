/**
 * Acuñación de sesiones de visitante.
 *
 * Orden de validación, y el orden importa: Origin, clave, rate limit y SOLO
 * ENTONCES signInAnonymously(). Los tres filtros van antes del minteo porque
 * son lo que evita que esto sea una fábrica abierta de filas en auth.users.
 */
import type { FastifyInstance } from 'fastify';
import { visitorSessionRequestSchema } from '@teams4soft/tess-types/api';

export async function visitorSessionsRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/visitor-sessions', async (request, reply) => {
    const parsed = visitorSessionRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        code: 'invalid_request',
        message: 'Clave pública ausente o mal formada.',
        retryable: false,
      });
    }

    const origin = request.headers.origin;

    // 1. Cabecera Origin requerida.
    if (!origin) {
      return reply.code(403).send({
        code: 'forbidden_origin',
        message: 'Origen no autorizado.',
        retryable: false,
      });
    }

    const settings = await app.readWidgetSettings(parsed.data.publicKey);

    // 2. Clave y proyecto: 404 y no 403 para no confirmar qué proyectos existen.
    if (!settings || !settings.visitor_access) {
      return reply.code(404).send({
        code: 'project_not_found',
        message: 'Proyecto no disponible.',
        retryable: false,
      });
    }

    // 3. Origen autorizado para el proyecto.
    if (!settings.allowed_origins.includes(origin)) {
      return reply.code(403).send({
        code: 'forbidden_origin',
        message: 'Origen no autorizado.',
        retryable: false,
      });
    }

    // 3. Rate limit por IP. trustProxy hace que request.ip sea la IP real.
    const limite = await app.rateLimiter.consume(
      `visitor-session:${request.ip}`,
      app.env.VISITOR_SESSION_LIMIT,
      app.env.VISITOR_SESSION_WINDOW_SECONDS,
    );

    if (!limite.allowed) {
      return reply
        .code(429)
        .header('retry-after', Math.ceil((limite.resetAt - Date.now()) / 1000))
        .send({
          code: 'rate_limited',
          message: 'Demasiadas peticiones.',
          retryable: true,
        });
    }

    // 4. Solo ahora.
    const session = await app.mintVisitorSession();

    // Sin correo, sin nombre, sin contenido: proyecto, IP y acción.
    await app.recordAuditEvent({
      organizationId: settings.organization_id,
      projectId: settings.project_id,
      actorId: session.userId,
      action: 'visitor.session.created',
      ip: request.ip,
    });

    return reply.code(201).send({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      userId: session.userId,
      projectId: settings.project_id,
      greeting: settings.greeting,
    });
  });
}
