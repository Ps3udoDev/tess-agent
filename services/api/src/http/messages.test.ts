import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createFakeModelProvider } from '../agent/model-provider.fake.js';
import type { ModelMessage, ModelProvider } from '../agent/model-provider.js';

const PROYECTO = '11111111-1111-1111-1111-111111111111';
const CONVERSACION = '44444444-4444-4444-4444-444444444444';

/**
 * Cliente de Supabase falso.
 *
 * `filas` es el historial cronológico de la conversación. El doble respeta la
 * semántica real de `order(..., { ascending })` + `limit(n)` —recortar por un
 * extremo u otro— porque justamente ahí estaba el fallo: pedir ascendente
 * devolvía las PRIMERAS filas, no las últimas.
 */
function clienteFalso(filas: ModelMessage[] = []) {
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
        // Por el camino del visitante RLS no devuelve nada: el prompt se lee
        // en el servidor con readAssistantConfig, no por aquí.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      // messages
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: (_columna: string, opciones?: { ascending?: boolean }) => ({
                limit: async (n: number) => {
                  const ordenadas =
                    opciones?.ascending === false ? [...filas].reverse() : [...filas];
                  return { data: ordenadas.slice(0, n), error: null };
                },
              }),
            }),
          }),
        }),
        insert: (fila: { role: string; content: string }) => {
          // El mensaje del usuario pasa a formar parte del historial, igual
          // que en la base real.
          filas.push({ role: fila.role as ModelMessage['role'], content: fila.content });
          return {
            select: () => ({
              single: async () => ({ data: { id: 'msg-user' }, error: null }),
            }),
          };
        },
      };
    },
  };
}

interface OpcionesApp {
  provider?: ModelProvider;
  historial?: ModelMessage[];
  systemPrompt?: string | null;
}

async function appDeChat(
  provider: ModelProvider = createFakeModelProvider({ reply: 'uno dos tres' }),
  opciones: OpcionesApp = {},
) {
  const app = await buildApp({ modelProvider: provider });
  vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso(opciones.historial ?? []) as never);
  vi.spyOn(app, 'readAssistantConfig').mockResolvedValue({
    system_prompt: opciones.systemPrompt ?? 'PROMPT SEMBRADO POR SQL',
    locale: 'es-MX',
  });
  vi.spyOn(app, 'insertAssistantMessage').mockResolvedValue({
    id: 'msg-assistant',
  });
  vi.spyOn(app, 'recordAuditEvent').mockResolvedValue(undefined);
  await app.ready();
  return app;
}

/** Captura los mensajes que de verdad llegan al modelo. */
function proveedorEspia(capturado: { mensajes: ModelMessage[] }): ModelProvider {
  return {
    async *stream(input) {
      capturado.mensajes = input.messages;
      yield 'ok';
    },
  };
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

  it('emite assistant.error aunque falle la persistencia del parcial', async () => {
    // La excepción de insertAssistantMessage escapaba del catch, el finally
    // cerraba el socket y el cliente veía un stream truncado sin desenlace.
    const app = await appDeChat(createFakeModelProvider({ reply: 'a b c d e', failAfter: 2 }));
    vi.spyOn(app, 'insertAssistantMessage').mockRejectedValue(
      new Error('no se pudo persistir la respuesta: 42501'),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: 'hola' },
    });

    expect(app.insertAssistantMessage).toHaveBeenCalled();
    expect(eventos(res.body)).toContain('assistant.error');
    expect(eventos(res.body).at(-1)).toBe('assistant.error');

    await app.close();
  });
});

describe('contexto del modelo', () => {
  it('manda los ÚLTIMOS 20 turnos, no los primeros, con más de 40 mensajes', async () => {
    // 50 mensajes previos: h0 es el más antiguo, h49 el más reciente.
    const historial: ModelMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `h${i}`,
    }));

    const capturado = { mensajes: [] as ModelMessage[] };
    const app = await appDeChat(proveedorEspia(capturado), { historial });

    await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: 'mensaje nuevo' },
    });

    const [sistema, ...resto] = capturado.mensajes;
    expect(sistema?.role).toBe('system');

    // system + 20 de contexto + el mensaje recién enviado.
    expect(resto).toHaveLength(21);

    const contexto = resto.slice(0, -1).map((m) => m.content);
    expect(contexto).toHaveLength(20);
    expect(contexto[0]).toBe('h30');
    expect(contexto.at(-1)).toBe('h49');

    // Lo antiguo ya no viaja, y lo reciente sí: era justo al revés.
    expect(contexto).not.toContain('h0');
    expect(contexto).not.toContain('h29');

    // El mensaje recién insertado va UNA sola vez y al final; el `slice(0,-1)`
    // ya no recorta un turno histórico en su lugar.
    expect(resto.at(-1)).toEqual({ role: 'user', content: 'mensaje nuevo' });
    expect(resto.filter((m) => m.content === 'mensaje nuevo')).toHaveLength(1);

    await app.close();
  });

  it('el system_prompt llega al modelo por el camino del visitante', async () => {
    // El cliente del usuario devuelve cero filas de assistant_configs —es un
    // anónimo, is_project_member es falso—. El prompt tiene que llegar igual,
    // leído en el servidor con service_role.
    const capturado = { mensajes: [] as ModelMessage[] };
    const app = await appDeChat(proveedorEspia(capturado), {
      systemPrompt: 'PROMPT SEMBRADO POR SQL',
    });

    await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: '¿Qué ofrecen?' },
    });

    expect(app.readAssistantConfig).toHaveBeenCalledWith(PROYECTO);
    expect(capturado.mensajes[0]?.role).toBe('system');
    expect(capturado.mensajes[0]?.content).toContain('PROMPT SEMBRADO POR SQL');
    // Y las reglas no anulables siguen yendo delante.
    expect(capturado.mensajes[0]?.content.indexOf('Reglas que ninguna configuración')).toBe(0);

    await app.close();
  });
});
