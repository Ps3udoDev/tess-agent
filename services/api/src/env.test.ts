import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/** Lo mínimo para que el esquema valide; cada test cambia lo que le importa. */
const BASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'x'.repeat(30),
  SUPABASE_SERVICE_ROLE_KEY: 'y'.repeat(30),
};

describe('loadEnv', () => {
  it('por defecto usa providers fake y no exige credenciales', () => {
    const env = loadEnv(BASE);
    expect(env.MODEL_PROVIDER).toBe('fake');
    expect(env.EMBEDDING_PROVIDER).toBe('fake');
  });

  it('MODEL_PROVIDER=openrouter exige clave y modelo de chat', () => {
    expect(() => loadEnv({ ...BASE, MODEL_PROVIDER: 'openrouter' })).toThrow(
      /OPENROUTER/,
    );
  });

  it('EMBEDDING_PROVIDER=openrouter exige clave y modelo de embeddings', () => {
    expect(() =>
      loadEnv({
        ...BASE,
        EMBEDDING_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'k',
      }),
    ).toThrow(/OPENROUTER_EMBEDDING_MODEL/);
  });

  it('rechaza que el modelo de chat y el de embeddings sean el mismo', () => {
    expect(() =>
      loadEnv({
        ...BASE,
        MODEL_PROVIDER: 'openrouter',
        EMBEDDING_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_CHAT_MODEL: 'a/b',
        OPENROUTER_EMBEDDING_MODEL: 'a/b',
      }),
    ).toThrow(/distinto/);
  });

  it('rechaza una dimensión que no sea 1536', () => {
    // La columna es vector(1536) y el índice HNSW está construido sobre ella.
    // Un valor distinto no es configuración: es un error que se manifestaría
    // como inserts rechazados en producción.
    expect(() => loadEnv({ ...BASE, EMBEDDING_DIMENSIONS: '768' })).toThrow(
      /1536/,
    );
  });

  it('acepta una configuración completa de openrouter', () => {
    const env = loadEnv({
      ...BASE,
      MODEL_PROVIDER: 'openrouter',
      EMBEDDING_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_CHAT_MODEL: 'anthropic/claude-sonnet-5',
      OPENROUTER_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    });
    expect(env.RAG_MATCH_COUNT).toBe(8);
    expect(env.RAG_SIMILARITY_THRESHOLD).toBe(0.5);
    expect(env.DOCUMENTS_BUCKET).toBe('tess-documents');
  });
});
