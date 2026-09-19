/**
 * CORS con allowlist dinámica.
 *
 * El preflight llega antes de saber de qué proyecto se trata, así que no se
 * puede consultar `project_widget_settings` por petición. Se precargan todos
 * los orígenes registrados y se refrescan cada 60 segundos.
 */
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

const REFRESCO_MS = 60_000;

async function plugin(app: FastifyInstance): Promise<void> {
  const delEntorno = app.env.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  let cache = new Set(delEntorno);
  let cargadoEn = 0;

  async function refrescar(): Promise<Set<string>> {
    if (Date.now() - cargadoEn < REFRESCO_MS) return cache;

    const filas = await app.listWidgetOrigins();
    cache = new Set([...delEntorno, ...filas]);
    cargadoEn = Date.now();
    return cache;
  }

  app.decorate('allowedOrigins', refrescar);

  await app.register(cors, {
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
    async origin(origin: string | undefined): Promise<boolean> {
      // Sin Origin: peticiones server-to-server y curl. Se permiten; quien
      // protege el recurso es el JWT, no CORS.
      if (!origin) return true;

      const permitidos = await refrescar();
      return permitidos.has(origin);
    },
  });
}

export const corsPlugin = fp(plugin, {
  name: 'cors',
  dependencies: ['supabase'],
});

declare module 'fastify' {
  interface FastifyInstance {
    allowedOrigins(): Promise<Set<string>>;
  }
}
