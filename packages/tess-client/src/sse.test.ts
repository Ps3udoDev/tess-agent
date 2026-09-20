import { describe, expect, it } from 'vitest';
import { parseSseStream } from './sse.js';

function streamDe(trozos: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const t of trozos) controller.enqueue(encoder.encode(t));
      controller.close();
    },
  });
}

async function recolectar(stream: ReadableStream<Uint8Array>) {
  const eventos = [];
  for await (const e of parseSseStream(stream)) eventos.push(e);
  return eventos;
}

describe('parseSseStream', () => {
  it('parsea una secuencia completa', async () => {
    const eventos = await recolectar(
      streamDe([
        'event: assistant.state\ndata: {"state":"thinking"}\n\n',
        'event: assistant.delta\ndata: {"text":"hola"}\n\n',
        'event: assistant.completed\ndata: {"messageId":"m1"}\n\n',
      ]),
    );

    expect(eventos).toHaveLength(3);
    expect(eventos[0]).toEqual({
      event: 'assistant.state',
      data: { state: 'thinking' },
    });
    expect(eventos[2]).toEqual({
      event: 'assistant.completed',
      data: { messageId: 'm1' },
    });
  });

  it('reensambla una trama partida a mitad de línea', async () => {
    const eventos = await recolectar(
      streamDe(['event: assistant.de', 'lta\ndata: {"te', 'xt":"hola"}\n\n']),
    );

    expect(eventos).toEqual([{ event: 'assistant.delta', data: { text: 'hola' } }]);
  });

  it('une un data: multilínea con saltos de línea', async () => {
    const eventos = await recolectar(
      streamDe(['event: assistant.delta\ndata: {"text":\ndata: "hola"}\n\n']),
    );

    expect(eventos).toEqual([{ event: 'assistant.delta', data: { text: 'hola' } }]);
  });

  it('ignora los comentarios de heartbeat', async () => {
    const eventos = await recolectar(
      streamDe([': ping\n\n', 'event: assistant.delta\ndata: {"text":"a"}\n\n', ': ping\n\n']),
    );

    expect(eventos).toHaveLength(1);
  });

  it('ignora un evento desconocido y sigue con el resto', async () => {
    // Es lo que permitirá a F3 emitir assistant.source, y a F4 sus eventos de
    // herramientas, contra widgets ya desplegados que nadie va a actualizar.
    const eventos = await recolectar(
      streamDe([
        'event: assistant.delta\ndata: {"text":"a"}\n\n',
        'event: futuro.inventado\ndata: {"lo":"que sea"}\n\n',
        'event: assistant.completed\ndata: {"messageId":"m1"}\n\n',
      ]),
    );

    expect(eventos.map((e) => e.event)).toEqual(['assistant.delta', 'assistant.completed']);
  });

  it('ignora un data: que no es JSON válido', async () => {
    const eventos = await recolectar(
      streamDe([
        'event: assistant.delta\ndata: {rota\n\n',
        'event: assistant.delta\ndata: {"text":"b"}\n\n',
      ]),
    );

    expect(eventos).toHaveLength(1);
  });
});
