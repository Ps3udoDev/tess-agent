/**
 * @teams4soft/tess-core
 *
 * Máquina de estados, bus de eventos y política de reduced-motion de Tess,
 * sin dependencia de framework ni de runtime de renderizado.
 */
import { ASSISTANT_STATES, type AssistantState } from '@teams4soft/tess-types';

export const INITIAL_STATE: AssistantState = 'idle';

export function isAssistantState(value: unknown): value is AssistantState {
  return typeof value === 'string' && (ASSISTANT_STATES as readonly string[]).includes(value);
}

export * from './core.js';
