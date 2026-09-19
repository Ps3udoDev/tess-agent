/**
 * Inicialización de Sentry para el proyecto `tess-api`.
 *
 * DEBE cargarse antes que cualquier otro módulo:
 *   producción -> node --import ./dist/instrument.js dist/main.js
 *   desarrollo -> tsx watch --import ./src/instrument.ts src/main.ts
 *
 * Nunca se importa desde `main.ts`: eso llegaría demasiado tarde para
 * instrumentar los módulos que Node ya habría resuelto.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.APP_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

    // Scrubbing. Los prompts, el contenido documental y las credenciales de
    // conectores no deben salir del servicio.
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  });
}
