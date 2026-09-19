import { defineConfig } from 'vitest/config';

// jsdom es necesario aunque el runtime de Rive vaya mockeado: el módulo usa
// HTMLCanvasElement, IntersectionObserver y ResizeObserver.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
