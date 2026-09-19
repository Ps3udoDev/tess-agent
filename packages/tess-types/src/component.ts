import type { AssistantState } from './assistant.js';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type TessTheme = (typeof THEMES)[number];

/** Enum cerrado: son los cuatro tamaños con QA visual capturada. */
export const SIZES = [48, 96, 128, 256] as const;
export type TessSize = (typeof SIZES)[number];
export const DEFAULT_SIZE: TessSize = 96;

export const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
export type TessPosition = (typeof POSITIONS)[number];
export const DEFAULT_POSITION: TessPosition = 'bottom-right';

/** Configuración que el web component acumula y pasará al cliente en F2. */
export interface TessAssistantConfig {
  apiUrl?: string;
  projectId?: string;
  locale?: string;
}

export interface TessStateDetail {
  state: AssistantState;
}

export interface TessErrorDetail {
  code: string;
  message: string;
}
