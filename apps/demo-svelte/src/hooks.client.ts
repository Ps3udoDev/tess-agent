import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

// DSN del proyecto `tess-frontend`. Es público por diseño: identifica el
// proyecto, no autoriza a leer nada.
const dsn = env.PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: env.PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    release: env.PUBLIC_APP_RELEASE,
    tracesSampleRate: Number(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '1.0'),
    integrations: [Sentry.browserTracingIntegration()],
    // Propaga el trace hacia la API de Tess para correlacionar navegador y backend.
    tracePropagationTargets: [/^\//, /^https:\/\/.*\.run\.app/],
    // No enviar contenido de conversaciones ni documentos privados.
    sendDefaultPii: false,
  });
}

export const handleError = Sentry.handleErrorWithSentry();
