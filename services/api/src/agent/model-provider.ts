/**
 * Proveedor de modelo.
 *
 * Devuelve deltas de texto y nada más: ni tokens, ni herramientas, ni citas.
 * F3 le añadirá contexto RAG AL PROMPT, sin tocar esta interfaz. F4 necesitará
 * herramientas, y ahí sí se ensanchará de forma aditiva.
 */
import type { TessEnv } from '../env.js';
import { createFakeModelProvider } from './model-provider.fake.js';
import { createGatewayModelProvider } from './model-provider.gateway.js';

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
 * CI corre siempre con `fake`. La conversación real contra AI Gateway es un
 * smoke test manual aparte, con MODEL_PROVIDER=gateway.
 */
export function createModelProvider(env: TessEnv): ModelProvider {
  return env.MODEL_PROVIDER === 'gateway'
    ? createGatewayModelProvider({
        model: env.MODEL_NAME,
        apiKey: env.AI_GATEWAY_API_KEY,
      })
    : createFakeModelProvider();
}
