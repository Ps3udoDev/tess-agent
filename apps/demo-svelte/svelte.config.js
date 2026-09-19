import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    experimental: {
      // SvelteKit >= 2.31: permite que Sentry se inicialice en
      // `src/instrumentation.server.ts` antes que cualquier otro módulo.
      instrumentation: { server: true },
      tracing: { server: true },
    },
  },
};

export default config;
