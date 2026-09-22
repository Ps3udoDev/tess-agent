import { describe, expect, it } from 'vitest';
import { createFakeEmbeddingProvider } from './fake.js';

/** Coseno de dos vectores ya normalizados: su producto escalar. */
function coseno(a: number[], b: number[]): number {
  return a.reduce((acc, valor, i) => acc + valor * b[i]!, 0);
}

describe('createFakeEmbeddingProvider', () => {
  const provider = createFakeEmbeddingProvider();

  it('devuelve exactamente 1536 dimensiones', async () => {
    const vector = await provider.embed('hola');
    expect(vector).toHaveLength(1536);
    expect(provider.dimensions).toBe(1536);
  });

  it('es determinista: el mismo texto da el mismo vector', async () => {
    const a = await provider.embed('migración de sistemas');
    const b = await provider.embed('migración de sistemas');
    expect(a).toEqual(b);
  });

  it('el coseno de un texto consigo mismo es 1', async () => {
    const v = await provider.embed('soporte gestionado');
    expect(coseno(v, v)).toBeCloseTo(1, 6);
  });

  it('textos que comparten vocabulario se parecen más que los que no', async () => {
    // Es lo que hace que los tests de recuperación puedan preguntar en vez de
    // copiar el texto literal de la sección.
    const base = await provider.embed('servicios de migración a la nube');
    const parecido = await provider.embed('migración a la nube para empresas');
    const distinto = await provider.embed('recetas de cocina italiana');

    expect(coseno(base, parecido)).toBeGreaterThan(coseno(base, distinto));
  });

  it('usa un identificador de modelo que no colisiona con uno real', () => {
    expect(provider.model).toBe('fake/deterministic-1536');
  });

  it('embedMany conserva el orden', async () => {
    const [a, b] = await provider.embedMany(['primero', 'segundo']);
    expect(a).toEqual(await provider.embed('primero'));
    expect(b).toEqual(await provider.embed('segundo'));
  });

  it('un texto vacío devuelve un vector de ceros, no NaN', async () => {
    const v = await provider.embed('');
    expect(v).toHaveLength(1536);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
  });
});
