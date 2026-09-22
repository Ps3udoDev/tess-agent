import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // El .env de la raíz, igual que hace services/api.
    env: { NODE_ENV: 'test' },
  },
});
