/**
 * @teams4soft/tess-types
 *
 * Contratos compartidos entre `apps/*`, `packages/*` y `services/*`.
 * Este paquete no contiene lógica: solo tipos, constantes y esquemas.
 *
 * TODO(fase-2): añadir los esquemas zod de request/response de la API.
 * TODO(fase-3): reexportar los tipos generados desde `src/generated/supabase.ts`.
 */
export { ASSISTANT_STATES, type AssistantState } from './assistant.js';
export { type AssistantStreamEvent, type AssistantStreamEventName } from './events.js';
