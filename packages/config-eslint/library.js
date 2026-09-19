import globals from 'globals';
import base from './base.js';

/**
 * Paquetes distribuibles (tess-core, tess-rive, tess-web-component, ...).
 * Corren en el navegador: prohibido tocar `process` o secretos de servidor.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message:
            'Los paquetes distribuibles no leen variables de entorno. Recibe la configuración por parámetro.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'import',
          property: 'meta',
          message:
            'Evita import.meta.env en paquetes publicables: acopla el paquete al bundler del consumidor.',
        },
      ],
    },
  },
];
