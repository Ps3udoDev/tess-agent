import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Los tests de RLS comparten base: en serie para que no se pisen.
    fileParallelism: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
