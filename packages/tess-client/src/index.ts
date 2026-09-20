/**
 * @teams4soft/tess-client
 *
 * Cliente del backend de Tess: envío de mensajes y consumo del stream SSE.
 *
 * Solo recibe una URL pública de API y un token de sesión limitado. Nunca
 * debe manejar la service role key de Supabase ni claves de modelo.
 */
import type {
  AssistantStreamEvent,
  ChatMessage,
  LeadInput,
  SendMessageInput,
  TessClientLike,
  TessViewer,
} from '@teams4soft/tess-types';
import { parseSseStream } from './sse.js';
import {
  createBrowserStorage,
  createSessionManager,
  type StoredSession,
  type TessSessionStorage,
} from './session.js';

export { createBrowserStorage, createMemoryStorage, type TessSessionStorage } from './session.js';
export { parseSseStream } from './sse.js';

export interface TessClientOptions {
  /** URL pública del servicio, p. ej. https://tess-api.<region>.run.app */
  apiUrl: string;
  projectId: string;
  /** Para acuñar sesión de visitante. Innecesaria si el host provee getToken. */
  publicKey?: string;
  /** Si el host ya autenticó a su usuario, se usa su sesión. */
  getToken?: () => string | Promise<string>;
  storage?: TessSessionStorage;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
}

export interface TessClient extends TessClientLike {
  getGreeting(): string | null;
}

export function createTessClient(options: TessClientOptions): TessClient {
  if (!options.publicKey && !options.getToken) {
    throw new Error(
      'createTessClient necesita publicKey (visitante) o getToken (host autenticado)',
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.apiUrl.replace(/\/$/, '');
  const raiz = `${base}/v1/projects/${options.projectId}`;

  async function pedirSesion(): Promise<StoredSession> {
    const res = await fetchImpl(`${base}/v1/visitor-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: options.publicKey }),
    });

    if (!res.ok) throw new Error(`no se pudo abrir sesión: ${res.status}`);

    const cuerpo = (await res.json()) as StoredSession;
    return cuerpo;
  }

  /**
   * Canjea el refresh token contra el API.
   *
   * Sin esto, al expirar el access token se reacuñaba una sesión: otro
   * `auth.uid()`, y el visitante perdía su historial y su lead a la hora. Es
   * lo contrario de la decisión central del spec.
   */
  async function refrescarSesion(refreshToken: string): Promise<StoredSession> {
    const res = await fetchImpl(`${base}/v1/visitor-sessions/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken, publicKey: options.publicKey }),
    });

    // Lanza a propósito: el gestor de sesión lo traduce en reacuñar, que es
    // lo correcto cuando el refresh token ya no vale.
    if (!res.ok) throw new Error(`no se pudo refrescar la sesión: ${res.status}`);

    return (await res.json()) as StoredSession;
  }

  const sesion = createSessionManager({
    storage: options.storage ?? createBrowserStorage(),
    key: `tess:session:${options.projectId}`,
    mint: pedirSesion,
    refresh: refrescarSesion,
  });

  async function token(): Promise<string> {
    return options.getToken ? await options.getToken() : await sesion.getToken();
  }

  /**
   * Un 401 inesperado se reintenta UNA vez tras refrescar.
   *
   * Si el host provee su propia sesión no hay nada que renovar aquí: el 401 es
   * suyo y se devuelve tal cual.
   */
  async function fetchAutenticado(url: string, init: RequestInit): Promise<Response> {
    const cabeceras = {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetchImpl(url, {
      ...init,
      headers: { ...cabeceras, Authorization: `Bearer ${await token()}` },
    });

    if (res.status !== 401 || options.getToken) return res;

    // `renew()` refresca si puede y reacuña si el refresh token ya no vale.
    const renovado = await sesion.renew();

    return fetchImpl(url, {
      ...init,
      headers: { ...cabeceras, Authorization: `Bearer ${renovado}` },
    });
  }

  async function pedirJson<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchAutenticado(`${raiz}${ruta}`, init);

    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${ruta}: ${res.status}`);
    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  }

  return {
    getGreeting: () => sesion.getSession()?.greeting ?? null,

    async *sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent> {
      const res = await fetchAutenticado(`${raiz}/conversations/${input.conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: input.text }),
        ...(input.signal ? { signal: input.signal } : {}),
      });

      // Un código de error llega como JSON: las cabeceras del stream todavía
      // no se enviaron. Se traduce al mismo evento que usaría el stream para
      // que el consumidor tenga un solo camino de error.
      if (!res.ok || !res.body) {
        const cuerpo = (await res.json().catch(() => null)) as {
          code: string;
          message: string;
          retryable: boolean;
        } | null;

        yield {
          event: 'assistant.error',
          data: cuerpo ?? {
            code: 'internal',
            message: 'Error inesperado.',
            retryable: true,
          },
        };
        return;
      }

      yield* parseSseStream(res.body);
    },

    async createConversation() {
      return pedirJson<{ conversationId: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async listMessages(conversationId: string) {
      return pedirJson<ChatMessage[]>(`/conversations/${conversationId}/messages`);
    },

    async getViewer() {
      return pedirJson<TessViewer>('/me');
    },

    async submitLead(input: LeadInput) {
      return pedirJson<{ leadId: string }>('/leads', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    clearSession() {
      sesion.clear();
    },
  };
}

/**
 * Cliente inerte de Fase 1.
 *
 * Se conserva para que el web component tenga un cliente por defecto cuando
 * no hay `api-url` ni `public-key` configurados.
 */
export function createNoopTessClient(): TessClientLike {
  return {
    // eslint-disable-next-line require-yield -- generador vacío intencional.
    async *sendMessage(_input: SendMessageInput) {
      return;
    },
  };
}
