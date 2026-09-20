import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

describe('corsPlugin', () => {
  it('refleja un origen del entorno', async () => {
    const app = await buildApp({
      env: { CORS_ALLOWED_ORIGINS: 'http://localhost:5173' },
    });
    vi.spyOn(app, 'listWidgetOrigins').mockResolvedValue([]);
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    await app.close();
  });

  it('no refleja un origen desconocido', async () => {
    const app = await buildApp({
      env: { CORS_ALLOWED_ORIGINS: 'http://localhost:5173' },
    });
    vi.spyOn(app, 'listWidgetOrigins').mockResolvedValue([]);
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://malicioso.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  it('refleja un origen dinámico proveniente de listWidgetOrigins', async () => {
    const app = await buildApp({
      env: { CORS_ALLOWED_ORIGINS: '' },
    });
    vi.spyOn(app, 'listWidgetOrigins').mockResolvedValue(['https://tienda.example']);
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://tienda.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBe('https://tienda.example');

    await app.close();
  });
});
