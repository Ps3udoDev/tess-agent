/**
 * Único texto de Fase 1. El diálogo va vacío, así que `locale` solo gobierna
 * las etiquetas accesibles del launcher y del panel.
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
