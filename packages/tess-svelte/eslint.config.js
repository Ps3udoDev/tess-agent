import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import library from '@teams4soft/config-eslint/library';

/**
 * `library` trae las reglas comunes a los paquetes distribuibles (sin
 * `process` ni `import.meta`). A diferencia del resto de `packages/*`, este
 * paquete contiene un componente `.svelte`, así que se añade a mano el
 * soporte de `eslint-plugin-svelte` (mismo patrón que
 * `@teams4soft/config-eslint/svelte`, pensado para `apps/*`).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...library,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
];
