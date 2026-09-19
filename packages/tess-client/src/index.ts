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
export type TessClientOptions = {
  /** URL pública del servicio, p. ej. https://tess-api.<region>.run.app */
  apiUrl: string;
  /** Devuelve el token de sesión vigente. Se invoca en cada petición. */
  getToken: () => string | Promise<string>;
};
