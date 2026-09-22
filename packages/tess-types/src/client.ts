import type { AssistantStreamEvent } from './events.js';

export interface SendMessageInput {
  conversationId: string;
  text: string;
  signal?: AbortSignal;
}

/** La forma que documenta la columna `messages.sources` en 0004. */
export interface MessageSource {
  documentId: string;
  sectionId: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO 8601
  incomplete?: boolean; // el stream se cortó a mitad
  sources?: MessageSource[]; // F3
}

export interface LeadInput {
  email?: string;
  fullName?: string;
  attribution?: Record<string, string>;
}

export interface TessViewer {
  userId: string;
  isAnonymous: boolean;
  isProjectMember: boolean;
  lead: LeadInput | null;
  collectLeadsFromMembers: boolean;
}

/**
 * Contrato que `tess-client` satisface.
 *
 * Los métodos añadidos en F2 son OPCIONALES a propósito: así
 * `createNoopTessClient()` de F1 sigue siendo válido sin tocarlo.
 */
export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
  createConversation?(): Promise<{ conversationId: string }>;
  listMessages?(conversationId: string): Promise<ChatMessage[]>;
  getViewer?(): Promise<TessViewer>;
  submitLead?(input: LeadInput): Promise<{ leadId: string }>;
  clearSession?(): void;
}
