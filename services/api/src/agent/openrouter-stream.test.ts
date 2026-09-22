import { describe, expect, it } from 'vitest';
import { leerStreamOpenRouter } from './openrouter-stream.js';

/** Convierte un texto SSE en el ReadableStream que devolvería fetch. */
function comoStream(sse: string, trozos = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(sse);
  const tamano = Math.ceil(bytes.length / trozos);

  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += tamano) {
        controller.enqueue(bytes.slice(i, i + tamano));
      }
      controller.close();
    },
  });
}

async function recoger(sse: string, trozos = 1) {
  const salida = [];
  for await (const chunk of leerStreamOpenRouter(comoStream(sse, trozos))) salida.push(chunk);
  return salida;
}

const delta = (texto: string, model = 'anthropic/claude-sonnet-5') =>
  `data: ${JSON.stringify({ model, choices: [{ delta: { content: texto } }] })}\n\n`;

describe('leerStreamOpenRouter', () => {
  it('extrae el texto de choices[0].delta.content', async () => {
    const chunks = await recoger(`${delta('Hola')}${delta(' mundo')}data: [DONE]\n\n`);
    expect(chunks.map((c) => c.texto).join('')).toBe('Hola mundo');
  });

  it('SALTA las líneas de keepalive `: OPENROUTER PROCESSING`', async () => {
    // Son comentarios SSE, no JSON. Un parser que haga JSON.parse de todo lo
    // que llega revienta en la primera, y llegan de verdad: OpenRouter las
    // manda para que no caiga la conexión.
    const sse = [
      ': OPENROUTER PROCESSING\n\n',
      delta('Hola'),
      ': OPENROUTER PROCESSING\n\n',
      delta(' mundo'),
      'data: [DONE]\n\n',
    ].join('');

    const chunks = await recoger(sse);
    expect(chunks.map((c) => c.texto).join('')).toBe('Hola mundo');
  });

  it('ignora el chunk final de usage, que no trae delta.content', async () => {
    // Llega justo antes de [DONE]. Acceder a ciegas a choices[0].delta.content
    // da undefined y lo concatena como "undefined" en la respuesta.
    const sse = [
      delta('Hola'),
      `data: ${JSON.stringify({ id: 'gen-abc', usage: { total_tokens: 12 } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');

    const chunks = await recoger(sse);
    const texto = chunks.map((c) => c.texto ?? '').join('');

    expect(texto).toBe('Hola');
    expect(texto).not.toContain('undefined');
  });

  it('termina en [DONE] y no intenta parsearlo', async () => {
    await expect(recoger(`${delta('x')}data: [DONE]\n\n`)).resolves.toBeDefined();
  });

  it('reensambla eventos partidos entre dos trozos de red', async () => {
    // Un `data:` puede llegar cortado por la mitad. Sin buffer, se pierde.
    const sse = `${delta('Una respuesta bastante larga')}${delta(' y su continuación')}data: [DONE]\n\n`;
    const chunks = await recoger(sse, 17);

    expect(chunks.map((c) => c.texto).join('')).toBe(
      'Una respuesta bastante larga y su continuación',
    );
  });

  it('expone el modelo que respondió de verdad', async () => {
    const chunks = await recoger(`${delta('x', 'openai/gpt-4o')}data: [DONE]\n\n`);
    expect(chunks[0]!.model).toBe('openai/gpt-4o');
  });

  it('un JSON corrupto no tumba el stream: se salta esa línea', async () => {
    const sse = `data: {no es json}\n\n${delta('Hola')}data: [DONE]\n\n`;
    const chunks = await recoger(sse);

    expect(chunks.map((c) => c.texto ?? '').join('')).toBe('Hola');
  });

  it('un stream vacío no produce nada y termina', async () => {
    expect(await recoger('')).toEqual([]);
  });
});
