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
