/**
 * Parser de `text/event-stream`.
 *
 * Separado del transporte para poder probarlo sin red. Es el módulo que más
 * test unitario recibe porque los fallos aquí son silenciosos: un delta que se
 * pierde no da error, solo produce una respuesta incompleta.
 */
import type { AssistantStreamEvent } from '@teams4soft/tess-types';

const CONOCIDOS = new Set([
  'assistant.state',
  'assistant.delta',
  'assistant.source',
  'assistant.completed',
  'assistant.error',
]);

function interpretarTrama(trama: string): AssistantStreamEvent | undefined {
  let nombre: string | undefined;
  const lineasData: string[] = [];

  for (const linea of trama.split('\n')) {
    // Los comentarios `:` son el heartbeat del servidor.
    if (linea.startsWith(':')) continue;
    if (linea.startsWith('event:')) nombre = linea.slice(6).trim();
    else if (linea.startsWith('data:')) lineasData.push(linea.slice(5).replace(/^ /, ''));
  }

  // Un evento desconocido se ignora y el stream continúa: es lo que permite a
  // fases posteriores emitir eventos nuevos contra widgets ya desplegados.
  if (!nombre || !CONOCIDOS.has(nombre) || lineasData.length === 0) return undefined;

  try {
    return {
      event: nombre,
      data: JSON.parse(lineasData.join('\n')),
    } as AssistantStreamEvent;
  } catch {
    return undefined;
  }
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<AssistantStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      // `stream: true` es lo que permite que un carácter multibyte partido
      // entre dos chunks se reensamble en vez de corromperse.
      buffer += decoder.decode(value, { stream: true });

      let corte = buffer.indexOf('\n\n');

      while (corte !== -1) {
        const trama = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);

        const evento = interpretarTrama(trama);
        if (evento) yield evento;

        corte = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
