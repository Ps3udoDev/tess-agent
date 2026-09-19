/**
 * Escritor de `text/event-stream`.
 *
 * Se escribe sobre `reply.raw` y no sobre `reply.send()` porque el cuerpo se
 * emite en trozos a lo largo del tiempo.
 */
import type { AssistantStreamEvent } from '@teams4soft/tess-types';

/** Mínimo de `ServerResponse` que necesitamos. Inyectable para tests. */
export interface SseSink {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
}

export interface SseWriter {
  send(event: AssistantStreamEvent): void;
  heartbeat(): void;
  close(): void;
  readonly closed: boolean;
}

export function createSseWriter(sink: SseSink): SseWriter {
  sink.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // `no-transform` y `X-Accel-Buffering` existen por los proxies: sin ellos
    // un intermediario puede acumular los deltas y entregarlos de golpe al
    // final, que es perder el streaming sin que nada dé error.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let cerrado = false;

  return {
    get closed() {
      return cerrado;
    },

    send(event) {
      if (cerrado) return;
      // JSON.stringify escapa los saltos de línea: uno real partiría la trama.
      sink.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    },

    heartbeat() {
      if (cerrado) return;
      sink.write(': ping\n\n');
    },

    close() {
      if (cerrado) return;
      cerrado = true;
      sink.end();
    },
  };
}
