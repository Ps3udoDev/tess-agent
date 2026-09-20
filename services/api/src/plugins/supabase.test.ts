import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../app.js';

describe('supabasePlugin', () => {
  it('expone userClient y las tres funciones de service_role', async () => {
    const app = await buildApp();

    expect(typeof app.userClient).toBe('function');
    expect(typeof app.mintVisitorSession).toBe('function');
    expect(typeof app.insertAssistantMessage).toBe('function');
    expect(typeof app.recordAuditEvent).toBe('function');

    await app.close();
  });

  it('no exporta el cliente service_role', async () => {
    const source = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8');
    // Solo debe existir una referencia a la key, dentro del módulo.
    expect(source).not.toMatch(/export\s+(const|function)\s+serviceClient/);
  });
});
