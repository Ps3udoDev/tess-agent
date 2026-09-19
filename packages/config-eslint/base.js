import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Reglas comunes a todo el monorepo. */
export const ignores = {
  ignores: [
    '**/dist/**',
    '**/build/**',
    '**/.svelte-kit/**',
    '**/.turbo/**',
    '**/.vercel/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/src/generated/**',
  ],
};

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  prettier,
);
