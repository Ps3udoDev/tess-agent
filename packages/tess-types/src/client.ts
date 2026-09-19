import type { AssistantStreamEvent } from './events.js';

export interface SendMessageInput {
  conversationId: string;
  text: string;
  signal?: AbortSignal;
}

/**
 * Contrato que `tess-client` debe satisfacer en F2.
 *
 * Se define en F1 para que el web component dependa de esta interfaz y no de
 * una implementación. En F2 cambia el factory, no el componente.
 */
export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
}
