import { describe, expect, it } from 'vitest';
import { fuentesParaEmitir, fuentesParaPersistir } from './citations.js';

const seccion = (
  documentId: string,
  documentTitle: string,
  ordinal: number,
) => ({
  sectionId: `sec-${documentId}-${ordinal}`,
  documentId,
  documentTitle,
  projectId: 'proj-1',
  ordinal,
  content: 'x',
  similarity: 0.7,
});

describe('fuentesParaEmitir', () => {
  it('deduplica por documento', () => {
    // Cuatro secciones del mismo PDF son UNA sola fuente para quien lee.
    const fuentes = fuentesParaEmitir([
      seccion('doc-1', 'Guía', 0),
      seccion('doc-1', 'Guía', 1),
      seccion('doc-1', 'Guía', 2),
    ]);

    expect(fuentes).toEqual([{ title: 'Guía', documentId: 'doc-1' }]);
  });

  it('conserva el orden de primera aparición', () => {
    // El orden de llegada es el de similitud descendente: la fuente más
    // relevante se anuncia primero.
    const fuentes = fuentesParaEmitir([
      seccion('doc-2', 'Precios', 0),
      seccion('doc-1', 'Guía', 0),
      seccion('doc-2', 'Precios', 1),
    ]);

    expect(fuentes.map((f) => f.documentId)).toEqual(['doc-2', 'doc-1']);
  });

  it('NO lleva sectionId', () => {
    const [fuente] = fuentesParaEmitir([seccion('doc-1', 'Guía', 0)]);
    expect(fuente).not.toHaveProperty('sectionId');
  });

  it('cero secciones, cero fuentes', () => {
    expect(fuentesParaEmitir([])).toEqual([]);
  });
});

describe('fuentesParaPersistir', () => {
  it('conserva TODAS las secciones, sin deduplicar', () => {
    // Lo que se emite es un resumen; lo que se guarda es el registro.
    const fuentes = fuentesParaPersistir([
      seccion('doc-1', 'Guía', 0),
      seccion('doc-1', 'Guía', 1),
    ]);

    expect(fuentes).toHaveLength(2);
    expect(fuentes[0]).toEqual({
      documentId: 'doc-1',
      sectionId: 'sec-doc-1-0',
      title: 'Guía',
    });
  });

  it('usa la forma que documenta la columna sources de 0004', () => {
    const [fuente] = fuentesParaPersistir([seccion('doc-1', 'Guía', 0)]);
    expect(Object.keys(fuente!).sort()).toEqual([
      'documentId',
      'sectionId',
      'title',
    ]);
  });

  it('cero secciones, lista vacía', () => {
    expect(fuentesParaPersistir([])).toEqual([]);
  });
});
