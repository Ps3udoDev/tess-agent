/**
 * Proveedor de modelo.
 *
 * Devuelve deltas de texto y nada más: ni tokens, ni herramientas, ni citas.
 * F3 le añadirá contexto RAG AL PROMPT, sin tocar esta interfaz. F4 necesitará
 * herramientas, y ahí sí se ensanchará de forma aditiva.
 */
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
