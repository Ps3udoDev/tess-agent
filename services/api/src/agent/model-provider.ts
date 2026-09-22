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
import { createOpenRouterModelProvider } from './model-provider.openrouter.js';

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
 * CI corre siempre con `fake`. La conversación real contra OpenRouter es un
 * smoke test manual aparte, con MODEL_PROVIDER=openrouter.
 */
export function createModelProvider(env: TessEnv): ModelProvider {
  if (env.MODEL_PROVIDER !== 'openrouter') return createFakeModelProvider();

  // loadEnv ya garantiza ambos; los asserts son para el tipo.
  if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_CHAT_MODEL) {
    throw new Error('MODEL_PROVIDER=openrouter requiere clave y modelo');
  }

  return createOpenRouterModelProvider({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_CHAT_MODEL,
    referer: env.OPENROUTER_HTTP_REFERER,
    appTitle: env.OPENROUTER_APP_TITLE,
    maxTokens: env.OPENROUTER_MAX_TOKENS,
  });
}
