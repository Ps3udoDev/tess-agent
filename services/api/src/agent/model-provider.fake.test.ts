import { describe, expect, it } from 'vitest';
import { createFakeModelProvider } from './model-provider.fake.js';

async function recolectar(iterable: AsyncIterable<string>): Promise<string[]> {
  const trozos: string[] = [];
  for await (const t of iterable) trozos.push(t);
  return trozos;
}

describe('createFakeModelProvider', () => {
  it('trocea la respuesta en varios deltas', async () => {
    const provider = createFakeModelProvider({ reply: 'uno dos tres cuatro' });
    const trozos = await recolectar(
      provider.stream({ messages: [], signal: new AbortController().signal }),
    );

    expect(trozos.length).toBeGreaterThan(1);
    expect(trozos.join('')).toBe('uno dos tres cuatro');
  });

  it('deja de producir cuando se aborta', async () => {
    const controller = new AbortController();
    const provider = createFakeModelProvider({ reply: 'a b c d e f g h' });

    const trozos: string[] = [];
    for await (const t of provider.stream({
      messages: [],
      signal: controller.signal,
    })) {
      trozos.push(t);
      if (trozos.length === 2) controller.abort();
    }

    expect(trozos.length).toBe(2);
  });

  it('refleja la instrucción de idioma para poder testear el idioma', async () => {
    const provider = createFakeModelProvider({ echoLanguage: true });
    const trozos = await recolectar(
      provider.stream({
        messages: [{ role: 'system', content: 'Responde en: en' }],
        signal: new AbortController().signal,
      }),
    );

    expect(trozos.join('')).toContain('en');
  });
});
