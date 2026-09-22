/**
 * Proveedor de modelo.
 *
 * Devuelve deltas de texto y nada más: ni tokens, ni herramientas, ni citas.
 * F3 le añade contexto RAG AL PROMPT, sin tocar esta interfaz. F4 necesitará
 * herramientas, y ahí sí se ensanchará de forma aditiva.
 *
 * F3 añadió `onMetadata`, opcional. Con OpenRouter el modelo que responde
 * puede no ser el pedido —hoy `allow_fallbacks` está en false, pero la
 * posibilidad existe—, y `stream()` solo devuelve texto: no había por dónde
 * saliera ese dato. Al ser opcional, `createFakeModelProvider()` no cambia.
 */
import type { TessEnv } from '../env.js';
import { createFakeModelProvider } from './model-provider.fake.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Para el log y la auditoría. Nunca lleva contenido de la conversación. */
export interface ModelCallMetadata {
  requestedModel: string;
  /** El que respondió de verdad. Puede diferir si hubo fallback. */
  actualModel?: string | undefined;
  provider: string;
  requestId?: string | undefined;
}

export interface ModelStreamInput {
  messages: ModelMessage[];
  signal: AbortSignal;
  onMetadata?: ((meta: ModelCallMetadata) => void) | undefined;
}

export interface ModelProvider {
  stream(input: ModelStreamInput): AsyncIterable<string>;
}

/**
 * Selector por entorno.
 *
 * F3 retiró Vercel AI Gateway. La rama de OpenRouter la añade la Tarea 16,
 * cuando exista el proveedor al que cambiarse; hasta entonces `fake` es el
 * único cableado, que es lo que CI usa de todos modos.
 */
export function createModelProvider(_env: TessEnv): ModelProvider {
  return createFakeModelProvider();
}
