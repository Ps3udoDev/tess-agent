import * as Sentry from '@sentry/sveltekit';

// `Sentry.init` vive en `src/instrumentation.server.ts`, no aquí.

export const handleError = Sentry.handleErrorWithSentry();

export const handle = Sentry.sentryHandle();
