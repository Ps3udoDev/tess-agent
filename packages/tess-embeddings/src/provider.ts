/**
 * Proveedor de embeddings.
 *
 * Gemelo de `ModelProvider` del API, y por la misma razón: CI no llama a la
 * red. `dimensions` está en la interfaz y no solo en el entorno para que quien
 * tenga un provider en la mano pueda validar sin leer configuración.
 *
 * El MISMO provider debe usarse al ingerir y al recuperar. Un corpus embebido
 * con `fake` y una pregunta embebida con `openrouter` no dan error: dan
 * resultados sin sentido. Por eso `p_model` es obligatorio en
 * match_document_sections.
 */
export interface EmbeddingProvider {
  /** Lo que se escribe en `document_embeddings.model`. */
  readonly model: string;
  readonly dimensions: number;
  embed(input: string, signal?: AbortSignal): Promise<number[]>;
  embedMany(input: string[], signal?: AbortSignal): Promise<number[][]>;
}

import { createFakeEmbeddingProvider } from './fake.js';
import { createOpenRouterEmbeddingProvider } from './openrouter.js';

export interface EmbeddingProviderEnv {
  EMBEDDING_PROVIDER: 'fake' | 'openrouter';
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_EMBEDDING_MODEL: string;
  OPENROUTER_HTTP_REFERER?: string | undefined;
  OPENROUTER_APP_TITLE: string;
  EMBEDDING_DIMENSIONS: number;
}

/**
 * Selector por entorno.
 *
 * CI corre siempre con `fake`. La ingestión real contra OpenRouter es un smoke
 * test manual aparte, con EMBEDDING_PROVIDER=openrouter.
 */
export function createEmbeddingProvider(env: EmbeddingProviderEnv): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER !== 'openrouter') {
    return createFakeEmbeddingProvider(env.EMBEDDING_DIMENSIONS);
  }

  // loadWorkerEnv ya garantiza que la clave existe; este assert es para el
  // tipo, no para la validación.
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('EMBEDDING_PROVIDER=openrouter requiere OPENROUTER_API_KEY');
  }

  return createOpenRouterEmbeddingProvider({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
    referer: env.OPENROUTER_HTTP_REFERER,
    appTitle: env.OPENROUTER_APP_TITLE,
  });
}
