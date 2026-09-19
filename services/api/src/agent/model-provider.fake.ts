/**
 * Proveedor determinista para tests y CI.
 *
 * No toca la red y no gasta crédito. `delayMs` es cero por defecto para que
 * los tests no esperen.
 */
import type { ModelProvider, ModelStreamInput } from './model-provider.js';

export interface FakeModelOptions {
  reply?: string;
  delayMs?: number;
  /** Devuelve el idioma pedido en el system prompt, para testear idioma. */
  echoLanguage?: boolean;
  /** Fuerza un fallo tras N deltas, para testear assistant.error. */
  failAfter?: number;
}

const RESPUESTA_POR_DEFECTO =
  'Teams4Soft ofrece servicios de migración, soporte gestionado e integración de sistemas.';

function idiomaPedido(messages: ModelStreamInput['messages']): string | undefined {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  return /Responde en:\s*([a-zA-Z-]+)/.exec(system)?.[1];
}

export function createFakeModelProvider(options: FakeModelOptions = {}): ModelProvider {
  const { delayMs = 0, echoLanguage = false, failAfter } = options;

  return {
    async *stream(input: ModelStreamInput) {
      const idioma = idiomaPedido(input.messages);
      const base = options.reply ?? RESPUESTA_POR_DEFECTO;
      const texto = echoLanguage && idioma ? `[${idioma}] ${base}` : base;

      // Trocear por palabras aproxima el comportamiento real sin pretender
      // imitar la tokenización de ningún proveedor.
      const palabras = texto.split(' ');
      let emitidos = 0;

      for (const [indice, palabra] of palabras.entries()) {
        if (input.signal.aborted) return;

        if (failAfter !== undefined && emitidos >= failAfter) {
          throw new Error('fallo simulado del modelo');
        }

        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

        yield indice === 0 ? palabra : ` ${palabra}`;
        emitidos += 1;
      }
    },
  };
}
