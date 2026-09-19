/**
 * @teams4soft/tess-web-component
 *
 * Define el elemento `<teams4soft-assistant>`: superficie universal del SDK.
 *
 * Importar este módulo registra el custom element (efecto secundario
 * intencional, por eso `sideEffects: true` en package.json).
 *
 * API pública prevista:
 *   atributos : state, theme, size, api-url, locale
 *   métodos   : openChat(), closeChat(), destroy()
 *   eventos   : tess:open, tess:close, tess:state, tess:error
 *
 * El panel de chat vive en el DOM, no en el canvas.
 */
import './element.js';

// `TAG_NAME` vive en `tess-types` (sin dependencias de DOM); se reexporta
// aquí para que la API pública de este paquete no cambie para quien ya
// importa `TAG_NAME` desde `@teams4soft/tess-web-component`.
export { TAG_NAME } from '@teams4soft/tess-types';
export { TessAssistantElement } from './element.js';
