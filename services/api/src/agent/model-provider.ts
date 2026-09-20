/**
 * Proveedor de modelo.
 *
 * Devuelve deltas de texto y nada más: ni tokens, ni herramientas, ni citas.
 * F3 le añadirá contexto RAG AL PROMPT, sin tocar esta interfaz. F4 necesitará
 * herramientas, y ahí sí se ensanchará de forma aditiva.
 */
import type { TessEnv } from '../env.js';
import { createFakeModelProvider } from './model-provider.fake.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelStreamInput {
  messages: ModelMessage[];
  signal: AbortSignal;
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
