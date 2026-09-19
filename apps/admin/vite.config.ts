import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Los source maps solo se suben cuando CI aporta el token de organización.
// Sin token el plugin se limita a instrumentar las funciones `load`, así que
// el build local no falla ni intenta hablar con Sentry.
const authToken = process.env.SENTRY_AUTH_TOKEN;
const release = process.env.APP_RELEASE;

export default defineConfig({
  plugins: [
    sentrySvelteKit({
      org: process.env.SENTRY_ORG ?? 'teams4soft',
      project: process.env.SENTRY_PROJECT_FRONTEND ?? 'tess-frontend',
      ...(authToken ? { authToken } : {}),
      ...(release ? { release: { name: release } } : {}),
      telemetry: false,
      sourcemaps: {
        disable: !authToken,
        // Los .map se suben a Sentry y se borran del artefacto desplegado,
        // para no exponer el código fuente públicamente.
        filesToDeleteAfterUpload: ['./.svelte-kit/output/**/*.map', './.vercel/output/**/*.map'],
      },
    }),
    sveltekit(),
  ],
  server: {
    fs: {
      // Permite servir el .riv desde packages/tess-rive/assets en dev.
      allow: ['../..'],
    },
  },
});
