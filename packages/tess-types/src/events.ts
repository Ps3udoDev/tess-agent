import type { AssistantState } from './assistant.js';

/**
 * Eventos SSE que emite `POST /v1/projects/{projectId}/conversations/{conversationId}/messages`
 * con `Content-Type: text/event-stream`.
 */
export type AssistantStreamEvent =
  | { event: 'assistant.state'; data: { state: AssistantState } }
  | { event: 'assistant.delta'; data: { text: string } }
  | { event: 'assistant.source'; data: { title: string; documentId: string; sectionId?: string } }
  | { event: 'assistant.completed'; data: { messageId: string } }
  | { event: 'assistant.error'; data: { code: string; message: string; retryable: boolean } };

export type AssistantStreamEventName = AssistantStreamEvent['event'];
