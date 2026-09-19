import * as Sentry from '@sentry/sveltekit';

// Se ejecuta antes que cualquier otro módulo del servidor, habilitado por
// `kit.experimental.instrumentation.server` en svelte.config.js.
// El SSR de las apps web reporta al mismo proyecto `tess-frontend`.
const dsn = process.env.PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    release: process.env.APP_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '1.0'),
    sendDefaultPii: false,
  });
}
