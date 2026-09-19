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

export { TAG_NAME, TessAssistantElement } from './element.js';
