import { describe, expect, it } from 'vitest';
import { createSseWriter, type SseSink } from './sse-writer.js';

function sinkFalso() {
  const escrito: string[] = [];
  const sink: SseSink = {
    writeHead: () => undefined,
    write: (chunk: string) => {
      escrito.push(chunk);
      return true;
    },
    end: () => undefined,
  };
  return { sink, escrito };
}

describe('createSseWriter', () => {
  it('escribe las cabeceras que impiden el buffering de los proxies', () => {
    const cabeceras: Record<string, string> = {};
    const sink: SseSink = {
      writeHead: (_code, h) => Object.assign(cabeceras, h),
      write: () => true,
      end: () => undefined,
    };

    createSseWriter(sink);

    expect(cabeceras['Content-Type']).toBe('text/event-stream');
    expect(cabeceras['Cache-Control']).toContain('no-transform');
    expect(cabeceras['X-Accel-Buffering']).toBe('no');
  });

  it('serializa un evento en formato de cable', () => {
    const { sink, escrito } = sinkFalso();
    const writer = createSseWriter(sink);

    writer.send({ event: 'assistant.delta', data: { text: 'hola' } });

    expect(escrito.join('')).toBe('event: assistant.delta\ndata: {"text":"hola"}\n\n');
  });

  it('escapa los saltos de línea del texto dentro del JSON', () => {
    const { sink, escrito } = sinkFalso();
    const writer = createSseWriter(sink);

    writer.send({ event: 'assistant.delta', data: { text: 'a\nb' } });

    // Un salto real partiría la trama SSE. JSON.stringify lo escapa.
    expect(escrito.join('')).toContain('data: {"text":"a\\nb"}');
    expect(escrito.join('').split('\n').length).toBe(4);
  });

  it('emite el heartbeat como comentario', () => {
    const { sink, escrito } = sinkFalso();
    const writer = createSseWriter(sink);

    writer.heartbeat();

    expect(escrito.join('')).toBe(': ping\n\n');
  });

  it('no escribe nada después de cerrar', () => {
    const { sink, escrito } = sinkFalso();
    const writer = createSseWriter(sink);

    writer.close();
    writer.send({ event: 'assistant.delta', data: { text: 'tarde' } });

    expect(escrito.join('')).toBe('');
  });
});
