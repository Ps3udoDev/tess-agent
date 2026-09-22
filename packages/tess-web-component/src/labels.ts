import type { AssistantState } from '@teams4soft/tess-types';

/**
 * Textos de accesibilidad y UI del asistente Tess.
 */
export const LABELS = {
  es: { launcher: 'Abrir el asistente Tess', dialog: 'Asistente Tess' },
  en: { launcher: 'Open the Tess assistant', dialog: 'Tess assistant' },
} as const;

export type TessLocale = keyof typeof LABELS;
export const DEFAULT_LOCALE: TessLocale = 'es';

export function labelsFor(locale: string | null | undefined) {
  return LABELS[locale as TessLocale] ?? LABELS[DEFAULT_LOCALE];
}

export interface ChatLabels {
  conversacion: string;
  escribe: string;
  enviar: string;
  fuentes: string;
  estados: Partial<Record<AssistantState, string>>;
}

const CHAT_ES: ChatLabels = {
  conversacion: 'Conversación con Tess',
  escribe: 'Escribe tu mensaje',
  enviar: 'Enviar',
  fuentes: 'Fuentes',
  estados: {
    thinking: 'Pensando',
    speaking: 'Respondiendo',
    error: 'Ocurrió un error',
    offline: 'Sin conexión',
  },
};

const CHAT_EN: ChatLabels = {
  conversacion: 'Conversation with Tess',
  escribe: 'Type your message',
  enviar: 'Send',
  fuentes: 'Sources',
  estados: {
    thinking: 'Thinking',
    speaking: 'Answering',
    error: 'Something went wrong',
    offline: 'Offline',
  },
};

export function chatLabelsFor(locale: string): ChatLabels {
  return locale.startsWith('en') ? CHAT_EN : CHAT_ES;
}
