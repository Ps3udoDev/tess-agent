/**
 * Embeddings vía OpenRouter, por REST.
 *
 * No se usa `@openrouter/ai-sdk-provider` a propósito: su versión con soporte
 * de embeddings exige `ai@^7` y el repo está en `ai@5`. Migrar dos majors para
 * envolver una llamada HTTP no sale a cuenta cuando `EmbeddingProvider` ya es
 * la abstracción que protege de un cambio de proveedor.
 *
 * `input` acepta un array, así que un lote es una petición.
 */
import type { EmbeddingProvider } from './provider.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

export interface OpenRouterEmbeddingOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  referer?: string | undefined;
  appTitle?: string | undefined;
  /** Inyectable para poder probar sin red. */
  fetchImpl?: typeof fetch | undefined;
}

interface RespuestaEmbeddings {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
}

export function createOpenRouterEmbeddingProvider(
  options: OpenRouterEmbeddingOptions,
): EmbeddingProvider {
  const llamar = options.fetchImpl ?? fetch;

  async function embedMany(
    input: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (input.length === 0) return [];

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (options.referer) headers['HTTP-Referer'] = options.referer;
    if (options.appTitle) headers['X-Title'] = options.appTitle;

    const respuesta = await llamar(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: options.model, input }),
      ...(signal ? { signal } : {}),
    });

    if (!respuesta.ok) {
      // El texto que se envió NO va en el error: es contenido del cliente.
      throw new Error(`OpenRouter embeddings respondió ${respuesta.status}`);
    }

    const cuerpo = (await respuesta.json()) as RespuestaEmbeddings;

    if (cuerpo.error) {
      throw new Error(
        `OpenRouter embeddings: ${cuerpo.error.message ?? 'error sin mensaje'}`,
      );
    }

    const filas = cuerpo.data ?? [];

    if (filas.length !== input.length) {
      throw new Error(
        `respuesta incompleta: ${filas.length} vectores para ${input.length} entradas`,
      );
    }

    // Se reordena por `index` en vez de confiar en el orden de llegada.
    const ordenados = new Array<number[]>(input.length);

    for (const [posicion, fila] of filas.entries()) {
      const indice = fila.index ?? posicion;
      const vector = fila.embedding;

      if (!vector)
        throw new Error('respuesta incompleta: una fila sin embedding');

      // La API no acepta un parámetro `dimensions`: se recibe el tamaño nativo
      // del modelo. Si no coincide con la columna vector(1536), hay que
      // enterarse aquí y no en el insert.
      if (vector.length !== options.dimensions) {
        throw new Error(
          `el modelo ${options.model} devolvió ${vector.length} dimensiones; se esperaban ${options.dimensions}`,
        );
      }

      ordenados[indice] = vector;
    }

    return ordenados;
  }

  return {
    model: options.model,
    dimensions: options.dimensions,
    async embed(input, signal) {
      const [vector] = await embedMany([input], signal);
      return vector!;
    },
    embedMany,
  };
}
