import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createFakeModelProvider } from '../agent/model-provider.fake.js';

const PROYECTO = '11111111-1111-1111-1111-111111111111';
const CONVERSACION = '44444444-4444-4444-4444-444444444444';

function clienteFalso() {
  return {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: '33333333-3333-3333-3333-333333333333',
            is_anonymous: true,
          },
        },
        error: null,
      }),
    },
    from(tabla: string) {
      if (tabla === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: PROYECTO,
                  organization_id: '22222222-2222-2222-2222-222222222222',
                },
              }),
            }),
          }),
        };
      }
      if (tabla === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: CONVERSACION, title: null, locale: 'es-MX' },
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (tabla === 'assistant_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { system_prompt: 'System prompt' },
                error: null,
              }),
            }),
          }),
        };
      }
      // messages
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({ limit: async () => ({ data: [], error: null }) }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'msg-user' }, error: null }),
          }),
        }),
      };
    },
  };
}

async function appDeChat(provider = createFakeModelProvider({ reply: 'uno dos tres' })) {
  const app = await buildApp({ modelProvider: provider });
  vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso() as never);
  vi.spyOn(app, 'insertAssistantMessage').mockResolvedValue({
    id: 'msg-assistant',
  });
  vi.spyOn(app, 'recordAuditEvent').mockResolvedValue(undefined);
  await app.ready();
  return app;
}

function eventos(cuerpo: string): string[] {
  return cuerpo
    .split('\n')
    .filter((l) => l.startsWith('event: '))
    .map((l) => l.slice(7));
}

const URL_MSG = `/v1/projects/${PROYECTO}/conversations/${CONVERSACION}/messages`;

describe('POST .../messages', () => {
  it('emite thinking, speaking, deltas y completed en ese orden', async () => {
    const app = await appDeChat();

    const res = await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: '¿Qué ofrecen?' },
    });

    expect(res.headers['content-type']).toContain('text/event-stream');

    const secuencia = eventos(res.body);
    expect(secuencia[0]).toBe('assistant.state');
    expect(secuencia[1]).toBe('assistant.state');
    expect(secuencia.filter((e) => e === 'assistant.delta').length).toBeGreaterThan(1);
    expect(secuencia.at(-1)).toBe('assistant.completed');

    // El servidor nunca emite idle ni success.
    expect(res.body).not.toContain('"state":"idle"');
    expect(res.body).not.toContain('"state":"success"');
    expect(res.body).toContain('"state":"thinking"');
    expect(res.body).toContain('"state":"speaking"');

    await app.close();
  });

  it('rechaza el contenido vacío antes de abrir el stream', async () => {
    const app = await appDeChat();

    const res = await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');

    await app.close();
  });

  it('error ANTES del primer delta: no persiste mensaje del asistente', async () => {
    const app = await appDeChat(createFakeModelProvider({ failAfter: 0 }));

    const res = await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: 'hola' },
    });

    expect(eventos(res.body)).toContain('assistant.error');
    expect(app.insertAssistantMessage).not.toHaveBeenCalled();

    await app.close();
  });

  it('error DESPUÉS de varios deltas: persiste lo producido como incompleto', async () => {
    const app = await appDeChat(createFakeModelProvider({ reply: 'a b c d e', failAfter: 2 }));

    const res = await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: 'hola' },
    });

    expect(eventos(res.body)).toContain('assistant.error');
    expect(app.insertAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ incomplete: true }),
    );

    await app.close();
  });
});
