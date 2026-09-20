/**
 * Punto de entrada de la API de Tess.
 */
import { buildApp } from './app.js';

const app = await buildApp();

// Cloud Run exige escuchar en 0.0.0.0, no en localhost.
await app.listen({ port: app.env.PORT, host: app.env.HOST });
