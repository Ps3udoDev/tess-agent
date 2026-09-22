/**
 * Dos formas de la misma cita.
 *
 * Lo que se EMITE es un resumen: una fuente por documento, sin `sectionId`.
 * Cuatro secciones del mismo PDF son una sola fuente para quien lee, y ocho
 * eventos para ocho secciones del mismo documento serían ruido.
 *
 * Lo que se GUARDA es el registro: todas las secciones con su id. Ahí sí
 * importa el detalle, para el panel de F5 y para poder auditar de dónde salió
 * una respuesta concreta.
 */
import type { RetrievedSection } from './retrieval.js';

/** La forma congelada de `assistant.source` desde F1. */
export interface FuenteEmitida {
  title: string;
  documentId: string;
}

/** La forma que documenta la columna `messages.sources` en 0004. */
export interface FuentePersistida {
  documentId: string;
  sectionId: string;
  title: string;
}

export function fuentesParaEmitir(sections: RetrievedSection[]): FuenteEmitida[] {
  const vistos = new Set<string>();
  const fuentes: FuenteEmitida[] = [];

  // Las secciones llegan por similitud descendente, así que el orden de
  // primera aparición es el de relevancia.
  for (const seccion of sections) {
    if (vistos.has(seccion.documentId)) continue;
    vistos.add(seccion.documentId);
    fuentes.push({
      title: seccion.documentTitle,
      documentId: seccion.documentId,
    });
  }

  return fuentes;
}

export function fuentesParaPersistir(sections: RetrievedSection[]): FuentePersistida[] {
  return sections.map((s) => ({
    documentId: s.documentId,
    sectionId: s.sectionId,
    title: s.documentTitle,
  }));
}
