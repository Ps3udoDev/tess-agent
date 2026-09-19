/**
 * Estados semánticos de Tess.
 *
 * Es el único vocabulario que cruza la frontera backend -> UI -> avatar.
 * `packages/tess-rive` los traduce a inputs de `TessStateMachine`; ningún
 * consumidor debería hablar de animaciones directamente.
 */
export const ASSISTANT_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'success',
  'error',
  'offline',
] as const;

export type AssistantState = (typeof ASSISTANT_STATES)[number];
