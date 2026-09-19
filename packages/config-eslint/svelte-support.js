import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

/**
 * Bloque de soporte de `eslint-plugin-svelte`, agnóstico del preset base
 * (`base`, `library`, ...) sobre el que se componga. Lo usa tanto
 * `@teams4soft/config-eslint/svelte` (apps SvelteKit, que compone sobre
 * `base`) como cualquier paquete de `packages/*` que contenga `.svelte` y
 * necesite componer sobre `library` en su lugar (p. ej. `tess-svelte`).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
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
