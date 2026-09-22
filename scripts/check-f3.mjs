/**
 * Comprobaciones estructurales de la Fase 3.
 *
 * Son invariantes que un test unitario no cubre porque son sobre la FORMA del
 * código, no sobre su comportamiento.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fallos = 0;

function fallar(mensaje) {
  console.error(`FALLO: ${mensaje}`);
  fallos += 1;
}

function archivosTs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (ruta.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

// 1. La ingesta no ocurre dentro de una petición HTTP.
// Se miran los ESPECIFICADORES de import, no el texto plano del archivo: un
// comentario que mencione el worker es legítimo y no debe tumbar el gate.
const PROHIBIDOS = [/(^|\/)extract\//, /(^|\/)chunk\.js$/, /(^|\/)persist\.js$/, /ingest-worker/];

for (const archivo of archivosTs('services/api/src')) {
  const contenido = readFileSync(archivo, 'utf8');
  const especificadores = [
    ...contenido.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/gm),
  ].map((m) => m[1]);

  for (const spec of especificadores) {
    if (PROHIBIDOS.some((re) => re.test(spec))) {
      fallar(`${archivo} importa '${spec}': la ingesta debe vivir solo en el worker`);
    }
  }
}

// 2. Ninguna dependencia de IA en el árbol.
for (const pkg of ['services/api/package.json', 'services/ingest-worker/package.json']) {
  const json = JSON.parse(readFileSync(pkg, 'utf8'));
  const deps = { ...json.dependencies, ...json.devDependencies };
  for (const nombre of Object.keys(deps)) {
    if (nombre === 'ai' || nombre.startsWith('@ai-sdk/') || nombre.startsWith('@openrouter/')) {
      fallar(`${pkg} declara '${nombre}': F3 llama a OpenRouter por REST`);
    }
  }
}

// 3. Los mimes soportados coinciden entre el API y el worker.
const enApi = readFileSync('services/api/src/http/documents.route.ts', 'utf8');
const enWorker = readFileSync('services/ingest-worker/src/extract/index.ts', 'utf8');

for (const mime of ['application/pdf', 'text/markdown', 'text/plain']) {
  if (!enApi.includes(mime)) fallar(`el API no acepta ${mime}`);
  if (!enWorker.includes(mime)) fallar(`el worker no extrae ${mime}`);
}

// 4. permissions.ts no ha vuelto: los permisos de RAG viven en SQL.
try {
  statSync('services/api/src/rag/permissions.ts');
  fallar('services/api/src/rag/permissions.ts existe: los permisos de RAG viven en 0013');
} catch {
  // No existe, que es lo correcto.
}

if (fallos > 0) {
  console.error(`\n${fallos} comprobación(es) estructural(es) fallaron.`);
  process.exit(1);
}

console.log('OK: comprobaciones estructurales de F3');
