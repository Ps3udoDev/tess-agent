import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

async function appConAuth() {
  const app = await buildApp();
  app.get('/privado', { preHandler: app.authenticate }, async (req) => req.auth);
  await app.ready();
  return app;
}

describe('authenticate', () => {
  it('rechaza sin cabecera Authorization', async () => {
    const app = await appConAuth();
    const res = await app.inject({ method: 'GET', url: '/privado' });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');

    await app.close();
  });

  it('rechaza un Bearer que no verifica', async () => {
    const app = await appConAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/privado',
      headers: { authorization: 'Bearer no-es-un-jwt' },
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});
