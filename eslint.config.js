import base from '@teams4soft/config-eslint/base';

/**
 * Lint de los archivos sueltos de la raíz. Cada workspace trae su propio
 * eslint.config.js: ESLint resuelve la configuración desde el paquete que
 * se está analizando, no desde la raíz.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  {
    ignores: ['apps/**', 'packages/**', 'services/**', 'tess-rive/**', 'supabase/**'],
  },
  ...base,
];
