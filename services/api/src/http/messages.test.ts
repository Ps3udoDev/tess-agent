import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { buildApp } from '../app.js';
import { createFakeModelProvider } from '../agent/model-provider.fake.js';
import type { ModelMessage, ModelProvider } from '../agent/model-provider.js';
import { createFakeEmbeddingProvider } from '@teams4soft/tess-embeddings';
import { retrieve, type RetrievedSection } from '../rag/retrieval.js';
import type * as RetrievalModule from '../rag/retrieval.js';

/**
 * Doble de `retrieve`, con `vi.mock`.
 *
 * `messages.route.ts` ya llama a `retrieve` de forma incondicional en el
 * paso 3b, así que el doble tiene que sustituir el módulo entero: no hay otro
 * punto de inyección en `app.ts` para esto (a diferencia de `modelProvider` y
 * `embedder`, que sí son overrides existentes), y añadir uno nuevo solo para
 * el test sería una vía de inyección de producción que nadie más usa. Por
 * defecto resuelve `[]`, que es lo que necesitan los tests de F2 —no pasan
 * por `enviarMensaje`— para seguir viendo el mismo comportamiento de antes.
 */
vi.mock('../rag/retrieval.js', async (importOriginal) => {
  const real = await importOriginal<typeof RetrievalModule>();
  return {
    ...real,
    retrieve: vi.fn(async (): Promise<RetrievedSection[]> => []),
  };
});

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

interface EventoSse {
  event: string;
  data: unknown;
}

/** Como `eventos()`, pero conserva el `data` de cada trama. */
function eventosConDatos(cuerpo: string): EventoSse[] {
  return cuerpo
    .split('\n\n')
    .filter((bloque) => bloque.startsWith('event: '))
    .map((bloque) => {
      const lineas = bloque.split('\n');
      // Cada trama SSE que emite el writer tiene exactamente dos líneas:
      // `event: ...` y `data: ...`.
      return {
        event: lineas[0]!.slice('event: '.length),
        data: JSON.parse(lineas[1]!.slice('data: '.length)) as unknown,
      };
    });
}

/**
 * Logger de prueba: conforma el mínimo que Fastify exige de `loggerInstance`
 * (ver `validateLogger` en fastify/lib/logger-factory.js) y empuja cada línea
 * registrada a `lineas`, para poder comprobar qué se logueó sin tocar stdout.
 */
function loggerDePrueba(lineas: object[]): FastifyBaseLogger {
  function registra(args: unknown[]): void {
    const [primero, segundo] = args;
    if (typeof primero === 'object' && primero !== null) {
      lineas.push({ ...(primero as Record<string, unknown>), msg: segundo });
    } else {
      lineas.push({ msg: primero });
    }
  }

  // El cast es porque este doble no reimplementa pino entero: solo lo que
  // `messages.route.ts` y el ciclo de vida de Fastify necesitan tocar.
  const logger = {
    level: 'info',
    info: (...args: unknown[]) => registra(args),
    error: (...args: unknown[]) => registra(args),
    warn: (...args: unknown[]) => registra(args),
    debug: (...args: unknown[]) => registra(args),
    trace: (...args: unknown[]) => registra(args),
    fatal: (...args: unknown[]) => registra(args),
    silent: () => {},
    child: () => logger,
  } as unknown as FastifyBaseLogger;

  return logger;
}

const URL_MSG = `/v1/projects/${PROYECTO}/conversations/${CONVERSACION}/messages`;

interface OpcionesEnvio {
  secciones?: RetrievedSection[];
  fallaRecuperacion?: boolean;
  auditorias?: Array<{ action: string }>;
  persistidos?: Array<{ sources?: unknown }>;
  lineasDeLog?: object[];
}

/**
 * Sobre el mismo montaje que usan los tests de F2 (`clienteFalso`,
 * `app.inject`), añade lo que necesita RAG: doble de `retrieve` por llamada,
 * y captura opcional de auditorías, de lo persistido y de lo logueado.
 */
async function enviarMensaje(opciones: OpcionesEnvio = {}): Promise<EventoSse[]> {
  const { secciones = [], fallaRecuperacion = false, auditorias, persistidos, lineasDeLog } =
    opciones;

  if (fallaRecuperacion) {
    vi.mocked(retrieve).mockRejectedValueOnce(new Error('fallo simulado de recuperación'));
  } else {
    vi.mocked(retrieve).mockResolvedValueOnce(secciones);
  }

  const app = await buildApp({
    modelProvider: createFakeModelProvider({ reply: 'uno dos tres' }),
    embedder: createFakeEmbeddingProvider(),
    ...(lineasDeLog ? { logger: loggerDePrueba(lineasDeLog) } : {}),
  });

  vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso([]) as never);
  vi.spyOn(app, 'readAssistantConfig').mockResolvedValue({
    system_prompt: 'PROMPT SEMBRADO POR SQL',
    locale: 'es-MX',
  });

  vi.spyOn(app, 'recordAuditEvent').mockImplementation(async (input) => {
    auditorias?.push({ action: input.action });
  });

  vi.spyOn(app, 'insertAssistantMessage').mockImplementation(async (input) => {
    persistidos?.push(input);
    return { id: 'msg-assistant' };
  });

  await app.ready();

  const res = await app.inject({
    method: 'POST',
    url: URL_MSG,
    headers: { authorization: 'Bearer t' },
    payload: { content: '¿Qué ofrecen?' },
  });

  await app.close();

  return eventosConDatos(res.body);
}

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

describe('RAG en el stream', () => {
  const seccion: RetrievedSection = {
    sectionId: 'sec-1',
    documentId: 'doc-1',
    documentTitle: 'Guía de servicios',
    projectId: 'proj-1',
    ordinal: 0,
    content: 'Ofrecemos migración a la nube.',
    similarity: 0.8,
  };

  it('emite assistant.source ANTES del primer assistant.delta', async () => {
    // El usuario tiene que ver de dónde sale la respuesta mientras se
    // escribe, que es el momento en que le sirve.
    const eventos = await enviarMensaje({ secciones: [seccion] });

    const iSource = eventos.findIndex((e) => e.event === 'assistant.source');
    const iDelta = eventos.findIndex((e) => e.event === 'assistant.delta');

    expect(iSource).toBeGreaterThanOrEqual(0);
    expect(iSource).toBeLessThan(iDelta);
  });

  it('emite una fuente por documento, no una por sección', async () => {
    const eventos = await enviarMensaje({
      secciones: [seccion, { ...seccion, sectionId: 'sec-2', ordinal: 1 }],
    });

    expect(eventos.filter((e) => e.event === 'assistant.source')).toHaveLength(
      1,
    );
  });

  it('la fuente lleva título y documentId, sin sectionId', async () => {
    const eventos = await enviarMensaje({ secciones: [seccion] });
    const fuente = eventos.find((e) => e.event === 'assistant.source')!;

    expect(fuente.data).toEqual({
      title: 'Guía de servicios',
      documentId: 'doc-1',
    });
  });

  it('sin secciones no emite ninguna fuente y contesta igual', async () => {
    // Pasa constantemente: un saludo no tiene nada que recuperar.
    const eventos = await enviarMensaje({ secciones: [] });

    expect(eventos.filter((e) => e.event === 'assistant.source')).toHaveLength(
      0,
    );
    expect(eventos.some((e) => e.event === 'assistant.completed')).toBe(true);
  });

  it('si la recuperación FALLA, la respuesta sigue sin citas', async () => {
    // La decisión de la tarea. Un fallo de RAG no puede convertirse en un
    // chat roto.
    const eventos = await enviarMensaje({ fallaRecuperacion: true });

    expect(eventos.some((e) => e.event === 'assistant.error')).toBe(false);
    expect(eventos.some((e) => e.event === 'assistant.completed')).toBe(true);
    expect(eventos.filter((e) => e.event === 'assistant.source')).toHaveLength(
      0,
    );
  });

  it('un fallo de recuperación queda auditado', async () => {
    // Como el fallo es invisible para el cliente, la auditoría es lo único
    // que lo hace visible para nosotros. No es opcional.
    const auditorias: Array<{ action: string }> = [];
    await enviarMensaje({ fallaRecuperacion: true, auditorias });

    expect(auditorias.map((a) => a.action)).toContain('rag.retrieval.failed');
  });

  it('un abort durante la recuperación NO se audita como fallo real', async () => {
    // Ronda de corrección 1: si el cliente cierra la pestaña mientras
    // `embed()` está en vuelo, `retrieve` rechaza con la MISMA señal que la
    // ruta ya usaba para el cierre normal. Eso no es un fallo de RAG, y
    // audit_events es la única señal de fallos reales: si el abort la
    // ensucia, deja de servir para nada.
    const auditorias: Array<{ action: string }> = [];

    // Necesitamos el `request` real de esta petición para simular, desde
    // dentro del doble de `retrieve`, el mismo evento 'close' que dispara el
    // cierre de pestaña —no hay otro gancho reutilizable de F2 para esto, así
    // que este es el mínimo determinista: un hook de Fastify que capture la
    // request en vuelo, y el propio doble de `retrieve` cerrándola antes de
    // rechazar, tal como pasaría si el cliente se desconectara a mitad del
    // `embed()`.
    let requestActual: FastifyRequest | undefined;

    const app = await buildApp({
      modelProvider: createFakeModelProvider({ reply: 'uno dos tres' }),
      embedder: createFakeEmbeddingProvider(),
    });
    app.addHook('onRequest', async (request) => {
      requestActual = request;
    });

    vi.spyOn(app, 'userClient').mockReturnValue(clienteFalso([]) as never);
    vi.spyOn(app, 'readAssistantConfig').mockResolvedValue({
      system_prompt: 'PROMPT SEMBRADO POR SQL',
      locale: 'es-MX',
    });
    vi.spyOn(app, 'recordAuditEvent').mockImplementation(async (input) => {
      auditorias.push({ action: input.action });
    });
    vi.spyOn(app, 'insertAssistantMessage').mockResolvedValue({ id: 'msg-assistant' });

    vi.mocked(retrieve).mockImplementationOnce(async () => {
      // El mismo 'close' que la ruta escucha para abortar el controller.
      requestActual!.raw.emit('close');
      throw new Error('abortado');
    });

    await app.ready();

    await app.inject({
      method: 'POST',
      url: URL_MSG,
      headers: { authorization: 'Bearer t' },
      payload: { content: '¿Qué ofrecen?' },
    });

    await app.close();

    expect(auditorias.map((a) => a.action)).not.toContain('rag.retrieval.failed');
  });

  it('persiste las secciones completas en sources', async () => {
    const persistidos: Array<{ sources?: unknown }> = [];
    await enviarMensaje({
      secciones: [seccion, { ...seccion, sectionId: 'sec-2', ordinal: 1 }],
      persistidos,
    });

    // Se emitió UNA fuente, pero se guardan las DOS secciones.
    expect(persistidos.at(-1)!.sources).toHaveLength(2);
  });

  it('el orden completo es state → source → state → delta → completed', async () => {
    const eventos = await enviarMensaje({ secciones: [seccion] });
    const nombres = eventos.map((e) => e.event);

    expect(nombres[0]).toBe('assistant.state'); // thinking
    expect(nombres[1]).toBe('assistant.source');
    expect(nombres.at(-1)).toBe('assistant.completed');
  });

  it('la telemetría no lleva el prompt ni el contenido de los documentos', async () => {
    const lineas: object[] = [];
    await enviarMensaje({ secciones: [seccion], lineasDeLog: lineas });

    const serializado = JSON.stringify(lineas);

    expect(serializado).not.toContain('Ofrecemos migración a la nube.');
    expect(serializado).not.toContain('Reglas que ninguna configuración');
    expect(serializado).toContain('retrievedSections');
  });
});
