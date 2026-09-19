import globals from 'globals';
import base from './base.js';
import svelteSupport from './svelte-support.js';

/**
 * Aplicaciones SvelteKit (apps/demo-svelte, apps/admin, apps/docs).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...svelteSupport,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
