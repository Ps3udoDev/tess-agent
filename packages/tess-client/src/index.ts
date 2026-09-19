/**
 * @teams4soft/tess-client
 *
 * Cliente del backend de Tess: envío de mensajes y consumo del stream SSE.
 *
 * Solo recibe una URL pública de API y un token de sesión limitado. Nunca
 * debe manejar la service role key de Supabase ni claves de modelo.
 *
 * TODO(fase-2): implementar `createTessClient({ apiUrl, getToken })` con
 * `sendMessage()`, reconexión y cancelación mediante AbortSignal.
 */
import type { SendMessageInput, TessClientLike } from '@teams4soft/tess-types';

export type TessClientOptions = {
  /** URL pública del servicio, p. ej. https://tess-api.<region>.run.app */
  apiUrl: string;
  /** Devuelve el token de sesión vigente. Se invoca en cada petición. */
  getToken: () => string | Promise<string>;
};

/**
 * Cliente inerte de Fase 1.
 *
 * Existe para que el web component dependa de `TessClientLike` y no de una
 * implementación concreta. En Fase 2 se sustituye por `createTessClient`
 * sin tocar la API pública del componente.
 */
export function createNoopTessClient(): TessClientLike {
  return {
    // eslint-disable-next-line require-yield -- generador vacío intencional: Fase 1 no emite eventos.
    async *sendMessage(_input: SendMessageInput) {
      return;
    },
  };
}
