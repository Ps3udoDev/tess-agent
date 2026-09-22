/**
 * El bloque de contexto que se inyecta en el prompt.
 *
 * Las etiquetas `[n]` NO son para que el modelo las escriba en la respuesta.
 * Las citas viajan por `assistant.source`, que es un evento aparte: el texto
 * es lo que el usuario lee y el componente lo renderiza tal cual. La
 * numeración existe para que el modelo pueda distinguir fuentes entre sí al
 * razonar.
 */
import type { RetrievedSection } from './retrieval.js';

const CABECERA = [
  'Contexto recuperado de la documentación del proyecto. Úsalo como única fuente',
  'para datos concretos. Si no contiene lo que se pregunta, dilo; no completes con',
  'conocimiento general.',
].join('\n');

export function construirBloqueContexto(sections: RetrievedSection[]): string {
  if (sections.length === 0) return '';

  const fuentes = sections.map(
    (s, i) =>
      `[${i + 1}] ${s.documentTitle} · sección ${s.ordinal}\n${s.content}`,
  );

  return `${CABECERA}\n\n${fuentes.join('\n\n')}`;
}
