/**
 * Ingestión documental: extracción, chunking y embeddings.
 *
 * TODO: implementar el bucle de trabajo. Expone /health porque Cloud Run
 * necesita un puerto en escucha incluso para servicios dirigidos por cola.
 */
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8081);
const host = process.env.HOST ?? '0.0.0.0';

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ingest-worker' }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, host);
