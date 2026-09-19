/**
 * Contrato del artefacto Rive, extraído de `tess-rive/scene.rml`.
 *
 * Estos nombres son la API pública del `.riv`. Si cambian en el editor de
 * Rive, este archivo y `assets/teams4soft-tess.riv` deben actualizarse juntos.
 */
export const ARTBOARD_NAME = 'Tess';
export const STATE_MACHINE_NAME = 'TessStateMachine';

export const ARTBOARD_SIZE = { width: 500, height: 500 } as const;

/** Inputs de tipo trigger. Se disparan una vez y la máquina vuelve a idle. */
export const RIVE_TRIGGERS = {
  greet: 'trigger_greet',
  success: 'trigger_success',
  error: 'trigger_error',
} as const;

/** Inputs booleanos. Mantienen un estado continuo mientras estén en `true`. */
export const RIVE_BOOLEANS = {
  listening: 'is_listening',
  thinking: 'is_thinking',
  speaking: 'is_speaking',
  reducedMotion: 'prefers_reduced_motion',
} as const;

/** Animaciones del artboard, a 60 fps. Solo referencia; se controlan vía la state machine. */
export const RIVE_ANIMATIONS = [
  'anim_idle',
  'anim_greeting',
  'anim_listening',
  'anim_thinking',
  'anim_speaking',
  'anim_success',
  'anim_error',
  'anim_reduced_motion',
] as const;

export type RiveTriggerName = (typeof RIVE_TRIGGERS)[keyof typeof RIVE_TRIGGERS];
export type RiveBooleanName = (typeof RIVE_BOOLEANS)[keyof typeof RIVE_BOOLEANS];
export type RiveAnimationName = (typeof RIVE_ANIMATIONS)[number];
