import globals from 'globals';
import base from './base.js';

/**
 * Servicios Node (services/api y workers).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@teams4soft/tess-web-component',
                '@teams4soft/tess-svelte',
                '@teams4soft/tess-react',
              ],
              message: 'Un servicio no debe importar paquetes de UI.',
            },
          ],
        },
      ],
    },
  },
];
