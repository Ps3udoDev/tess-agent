/**
 * Ingestión documental: extracción, chunking y embeddings.
 *
 * Fuera de toda petición interactiva, que es lo que el roadmap exige de esta
 * fase. Expone `/health` porque Cloud Run necesita un puerto en escucha
 * incluso para servicios dirigidos por cola.
 */
import { createServer } from 'node:http';
import pino from 'pino';
import { loadWorkerEnv } from './env.js';
import { crearClienteServicio } from './supabase.js';
import { reclamarDocumento } from './claim.js';
import { procesarDocumento } from './process.js';
import { createEmbeddingProvider } from '@teams4soft/tess-embeddings';
import { crearBucle } from './loop.js';

const env = loadWorkerEnv();
const log = pino({ level: env.LOG_LEVEL });
const client = crearClienteServicio(env);
const embedder = createEmbeddingProvider(env);

log.info(
  {
    model: embedder.model,
    dimensions: embedder.dimensions,
    provider: env.EMBEDDING_PROVIDER,
  },
  'worker de ingestión arrancando',
);

const bucle = crearBucle({
  reclamar: () => reclamarDocumento(client),
  procesar: (documento) =>
    procesarDocumento({
      client,
      documento,
      embedder,
      bucket: env.DOCUMENTS_BUCKET,
      dimensions: env.EMBEDDING_DIMENSIONS,
      log,
    }),
  intervaloMs: env.INGEST_POLL_INTERVAL_MS,
  log,
});

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ingest-worker' }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(env.PORT, env.HOST);

/**
 * Apagado limpio. Cloud Run manda SIGTERM antes de matar el contenedor: se
 * deja de reclamar trabajo nuevo, pero el documento en curso termina. Si se
 * cortara a mitad, quedaría en `processing` para siempre.
 */
function apagar(senal: string): void {
  log.info({ senal }, 'apagando worker');
  bucle.parar();
  server.close();
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

await bucle.arrancar();

log.info({}, 'worker detenido');
