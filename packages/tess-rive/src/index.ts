/**
 * @teams4soft/tess-rive
 *
 * Carga `teams4soft-tess.riv`, instancia `TessStateMachine` y traduce los
 * `AssistantState` de tess-core a inputs de Rive.
 *
 * `mountTessRive({ canvas, core })` monta el artboard, suscribe el core y
 * traduce cada `AssistantState` a los inputs booleanos y de trigger de
 * `TessStateMachine`. Devuelve un `TessRiveHandle` con `greet()` y `destroy()`.
 */
export * from './contract.js';
export * from './mount.js';
