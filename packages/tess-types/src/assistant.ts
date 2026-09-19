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

/**
 * Estados que el integrador puede solicitar.
 *
 * `offline` queda fuera a propósito: lo deriva `tess-core` de la
 * conectividad, no se pide desde fuera.
 */
export type RequestedState = Exclude<AssistantState, 'offline'>;

export function isRequestedState(value: unknown): value is RequestedState {
  return (
    typeof value === 'string' &&
    value !== 'offline' &&
    (ASSISTANT_STATES as readonly string[]).includes(value)
  );
}
