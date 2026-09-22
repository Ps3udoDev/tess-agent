import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env.js';

const BASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'y'.repeat(30),
};

describe('loadWorkerEnv', () => {
  it('por defecto usa el provider fake', () => {
    expect(loadWorkerEnv(BASE).EMBEDDING_PROVIDER).toBe('fake');
  });

  it('openrouter exige la clave', () => {
    expect(() => loadWorkerEnv({ ...BASE, EMBEDDING_PROVIDER: 'openrouter' })).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it('rechaza una dimensión que no sea 1536', () => {
    expect(() => loadWorkerEnv({ ...BASE, EMBEDDING_DIMENSIONS: '3072' })).toThrow(/1536/);
  });

  it('el intervalo de sondeo tiene suelo', () => {
    expect(() => loadWorkerEnv({ ...BASE, INGEST_POLL_INTERVAL_MS: '10' })).toThrow();
  });
});
