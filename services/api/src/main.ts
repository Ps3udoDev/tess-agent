/**
 * Punto de entrada de la API de Tess.
 *
 * TODO(fase-2): registrar plugins, autenticación, resolución de tenant y las
 * rutas de `src/http`. Hoy solo levanta el servidor con /health.
 */
import Fastify from 'fastify';

const port = Number(process.env.PORT ?? 8080);
// Cloud Run exige escuchar en 0.0.0.0, no en localhost.
const host = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Cloud Run y Vercel terminan TLS por delante del contenedor.
  trustProxy: true,
});

app.get('/health', () => ({ status: 'ok', release: process.env.APP_RELEASE ?? 'dev' }));

await app.listen({ port, host });
