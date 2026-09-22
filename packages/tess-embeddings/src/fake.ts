/**
 * Embeddings deterministas para tests y CI.
 *
 * No es ruido: es un hashing vectorizer. Cada palabra cae en un índice fijo
 * del vector y el resultado se normaliza, así que dos textos que comparten
 * vocabulario tienen coseno alto de verdad. Eso permite que un test de
 * recuperación pregunte «¿qué servicios de migración ofrecen?» y encuentre la
 * sección que habla de migración, en vez de tener que copiar su texto literal.
 *
 * No se parece a un embedding real y no pretende hacerlo. Cumple lo único que
 * los tests necesitan: determinismo, dimensión correcta y una noción de
 * cercanía que se comporta como la de verdad.
 */
import type { EmbeddingProvider } from './provider.js';

const DIMENSIONES = 1536;
const MODELO = 'fake/deterministic-1536';

/** FNV-1a de 32 bits. Estable entre procesos y plataformas. */
function hash(texto: string, semilla: number): number {
  let h = 0x811c9dc5 ^ semilla;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0);
}

function vectorizar(texto: string, dimensiones: number): number[] {
  const vector = new Array<number>(dimensiones).fill(0);

  for (const palabra of palabras(texto)) {
    const indice = hash(palabra, 0) % dimensiones;
    // El segundo hash da el signo: evita que todo el vector sea positivo, que
    // dejaría a cualquier par de textos con coseno artificialmente alto.
    const signo = hash(palabra, 1) % 2 === 0 ? 1 : -1;
    // `indice` es siempre < dimensiones (resto de una división), así que el
    // acceso es válido pese a `noUncheckedIndexedAccess`.
    vector[indice]! += signo;
  }

  const norma = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));

  // Un texto sin palabras da norma 0. Devolver ceros es correcto y evita NaN.
  if (norma === 0) return vector;

  return vector.map((v) => v / norma);
}

export function createFakeEmbeddingProvider(
  dimensiones = DIMENSIONES,
): EmbeddingProvider {
  return {
    model: MODELO,
    dimensions: dimensiones,
    async embed(input: string) {
      return vectorizar(input, dimensiones);
    },
    async embedMany(input: string[]) {
      return input.map((texto) => vectorizar(texto, dimensiones));
    },
  };
}
