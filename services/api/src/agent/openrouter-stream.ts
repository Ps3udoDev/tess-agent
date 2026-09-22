/**
 * Lector del `text/event-stream` de OpenRouter.
 *
 * Archivo propio porque tiene tres trampas, y las tres se manifiestan en
 * producción y no en local:
 *
 *   1. OpenRouter intercala comentarios SSE, `: OPENROUTER PROCESSING`, como
 *      keepalive para que no caiga la conexión. NO son JSON.
 *   2. El terminador es `data: [DONE]`, que tampoco es JSON.
 *   3. Justo antes del `[DONE]` llega un chunk que solo trae `usage`, sin
 *      `choices[0].delta.content`. Leerlo a ciegas da `undefined` y lo
 *      concatena como la cadena "undefined" en la respuesta del asistente.
 *
 * Y una cuarta que no es de OpenRouter sino de TCP: un evento puede llegar
 * partido entre dos trozos, así que hace falta un búfer.
 */

export interface ChunkOpenRouter {
  /** El delta de texto, si este chunk trae uno. */
  texto?: string | undefined;
  /** El modelo que respondió. Puede no ser el pedido si hubo fallback. */
  model?: string | undefined;
}

interface CuerpoChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string } }>;
}

export async function* leerStreamOpenRouter(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChunkOpenRouter> {
  const lector = body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;

      buffer += decodificador.decode(value, { stream: true });

      // Los eventos se separan por línea en blanco, pero partir por '\n' y
      // dejar el resto en el búfer es suficiente y más tolerante.
      const lineas = buffer.split('\n');
      buffer = lineas.pop() ?? '';

      for (const lineaCruda of lineas) {
        const linea = lineaCruda.trim();

        if (linea.length === 0) continue;

        // Trampa 1: comentario SSE. `: OPENROUTER PROCESSING` y cualquier otro.
        if (linea.startsWith(':')) continue;

        if (!linea.startsWith('data:')) continue;

        const carga = linea.slice(5).trim();

        // Trampa 2.
        if (carga === '[DONE]') return;

        let cuerpo: CuerpoChunk;

        try {
          cuerpo = JSON.parse(carga) as CuerpoChunk;
        } catch {
          // Un chunk corrupto no debe tumbar una respuesta que va por la mitad.
          continue;
        }

        // Trampa 3: `?? undefined` y no `?? ''`, para que el llamante pueda
        // distinguir «sin texto» de «texto vacío» y no acumule nada.
        const texto = cuerpo.choices?.[0]?.delta?.content;

        yield { texto: texto ?? undefined, model: cuerpo.model };
      }
    }
  } finally {
    // Si el consumidor abandona el generador —porque abortó la petición— hay
    // que soltar el lector o la conexión queda colgada.
    await lector.cancel().catch(() => undefined);
  }
}
