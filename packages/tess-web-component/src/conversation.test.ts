import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TessHttpError } from '@teams4soft/tess-client';
import { TAG_NAME, type AssistantStreamEvent } from '@teams4soft/tess-types';
import './index.js';

function clienteFalso(eventos: AssistantStreamEvent[]) {
  return {
    createConversation: vi.fn(async () => ({ conversationId: 'c1' })),
    listMessages: vi.fn(async () => []),
    getViewer: vi.fn(async () => ({
      userId: 'u1',
      isAnonymous: true,
      isProjectMember: false,
      lead: null,
      collectLeadsFromMembers: false,
    })),
    submitLead: vi.fn(async () => ({ leadId: 'l1' })),
    async *sendMessage() {
      for (const e of eventos) yield e;
    },
  };
}

type ElementoTess = HTMLElement & {
  setClient(c: unknown): void;
  openChat(): void;
};

async function montar(cliente: unknown, projectId?: string): Promise<ElementoTess> {
  const el = document.createElement(TAG_NAME) as ElementoTess;
  if (projectId) el.setAttribute('project-id', projectId);
  document.body.append(el);
  el.setClient(cliente);
  el.openChat();
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

async function montarConCliente(eventos: AssistantStreamEvent[]) {
  return montar(clienteFalso(eventos));
}

// El id de conversación se persiste: sin limpiar, un test arrastraría el de
// otro y `createConversation` no llegaría a llamarse.
beforeEach(() => {
  localStorage.clear();
});

/** Escucha desde el documento: `tess:error` burbujea y es `composed`. */
function capturarErrores(): string[] {
  const vistos: string[] = [];
  document.addEventListener('tess:error', (e) => {
    vistos.push((e as CustomEvent<{ code: string }>).detail.code);
  });
  return vistos;
}

function enviar(el: ElementoTess, texto: string): void {
  el.shadowRoot!.querySelector('textarea')!.value = texto;
  el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('conversación', () => {
  it('pinta el mensaje del usuario y la respuesta completa', async () => {
    const el = await montarConCliente([
      { event: 'assistant.state', data: { state: 'thinking' } },
      { event: 'assistant.state', data: { state: 'speaking' } },
      { event: 'assistant.delta', data: { text: 'hola ' } },
      { event: 'assistant.delta', data: { text: 'mundo' } },
      { event: 'assistant.completed', data: { messageId: 'm1' } },
    ]);

    const campo = el.shadowRoot!.querySelector('textarea')!;
    campo.value = '¿qué ofrecen?';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise((r) => setTimeout(r, 10));

    const log = el.shadowRoot!.querySelector('[part="messages"]')!;
    expect(log.textContent).toContain('¿qué ofrecen?');
    expect(log.textContent).toContain('hola mundo');

    el.remove();
  });

  it('emite tess:message por cada turno', async () => {
    const el = await montarConCliente([
      { event: 'assistant.delta', data: { text: 'ok' } },
      { event: 'assistant.completed', data: { messageId: 'm1' } },
    ]);

    const vistos: string[] = [];
    el.addEventListener('tess:message', (e) => {
      vistos.push((e as CustomEvent<{ role: string }>).detail.role);
    });

    el.shadowRoot!.querySelector('textarea')!.value = 'hola';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));

    expect(vistos).toEqual(['user', 'assistant']);

    el.remove();
  });

  it('traduce assistant.error a estado error', async () => {
    const el = await montarConCliente([
      {
        event: 'assistant.error',
        data: { code: 'model_unavailable', message: 'ups', retryable: true },
      },
    ]);

    const errores: string[] = [];
    el.addEventListener('tess:error', (e) => {
      errores.push((e as CustomEvent<{ code: string }>).detail.code);
    });

    el.shadowRoot!.querySelector('textarea')!.value = 'hola';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));

    expect(errores).toContain('model_unavailable');

    el.remove();
  });
});

describe('fallos del cliente', () => {
  const VIEWER = {
    userId: 'u1',
    isAnonymous: true,
    isProjectMember: false,
    lead: null,
    collectLeadsFromMembers: false,
  };

  it('un cliente que lanza emite tess:error y NO se queda en «Pensando»', async () => {
    // Un `Origin` rechazado, un 401 o el API caído: la promesa revienta y no
    // llega ningún `assistant.error`.
    const el = await montar({
      createConversation: vi.fn(async () => ({ conversationId: 'c1' })),
      listMessages: vi.fn(async () => []),
      getViewer: vi.fn(async () => VIEWER),
      // eslint-disable-next-line require-yield -- lanza antes del primer yield.
      async *sendMessage() {
        throw new TypeError('Failed to fetch');
      },
    });

    const errores: string[] = [];
    el.addEventListener('tess:error', (e) => {
      errores.push((e as CustomEvent<{ code: string }>).detail.code);
    });

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    expect(errores).toContain('internal');

    // La región viva no se queda anunciando «Pensando» para siempre.
    const estado = el.shadowRoot!.querySelector('[part="status"]')!;
    expect(estado.textContent).not.toBe('Pensando');
    expect(estado.textContent).toBe('Ocurrió un error');

    // Y la burbuja en curso se confirmó: nada queda con aria-busy colgando.
    expect(el.shadowRoot!.querySelector('[part="streaming"]')!.textContent).toBe('');

    el.remove();
  });

  it('si createConversation lanza, también emite tess:error', async () => {
    const el = await montar({
      createConversation: vi.fn(async () => {
        throw new Error('401');
      }),
      listMessages: vi.fn(async () => []),
      getViewer: vi.fn(async () => VIEWER),
      async *sendMessage() {
        yield { event: 'assistant.delta', data: { text: 'no debería llegar' } };
      },
    });

    const errores: string[] = [];
    el.addEventListener('tess:error', (e) => {
      errores.push((e as CustomEvent<{ code: string }>).detail.code);
    });

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    expect(errores).toContain('internal');

    el.remove();
  });

  it('si getViewer lanza, el chat sigue funcionando y se avisa', async () => {
    // Antes `#viewer` se quedaba undefined y el formulario de lead no
    // aparecía jamás, sin que nadie se enterara.
    //
    // El listener va ANTES de montar: `getViewer()` se llama al abrir.
    const errores = capturarErrores();

    const el = await montar({
      createConversation: vi.fn(async () => ({ conversationId: 'c1' })),
      listMessages: vi.fn(async () => []),
      getViewer: vi.fn(async () => {
        throw new Error('API caído');
      }),
      async *sendMessage() {
        yield { event: 'assistant.delta', data: { text: 'ok' } };
        yield { event: 'assistant.completed', data: { messageId: 'm1' } };
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(errores).toContain('viewer');

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    expect(el.shadowRoot!.querySelector('[part="messages"]')!.textContent).toContain('ok');

    el.remove();
  });
});

describe('recuperación de la conversación', () => {
  const PROYECTO = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    localStorage.clear();
  });

  it('guarda el id de la conversación al crearla', async () => {
    const el = await montar(
      clienteFalso([{ event: 'assistant.delta', data: { text: 'ok' } }]),
      PROYECTO,
    );

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    expect(localStorage.getItem(`tess:conversation:${PROYECTO}`)).toBe('c1');

    el.remove();
  });

  it('al reabrir, repinta el historial y NO crea otra conversación', async () => {
    localStorage.setItem(`tess:conversation:${PROYECTO}`, 'c-previa');

    const cliente = {
      createConversation: vi.fn(async () => ({ conversationId: 'c-nueva' })),
      listMessages: vi.fn(async () => [
        { id: 'm1', role: 'user' as const, content: 'pregunta de ayer', createdAt: '2026-09-18' },
        {
          id: 'm2',
          role: 'assistant' as const,
          content: 'respuesta de ayer',
          createdAt: '2026-09-18',
        },
      ]),
      getViewer: vi.fn(async () => ({
        userId: 'u1',
        isAnonymous: true,
        isProjectMember: false,
        lead: null,
        collectLeadsFromMembers: false,
      })),
      async *sendMessage() {
        yield { event: 'assistant.completed', data: { messageId: 'm3' } };
      },
    };

    const el = await montar(cliente, PROYECTO);
    await new Promise((r) => setTimeout(r, 10));

    expect(cliente.listMessages).toHaveBeenCalledWith('c-previa');

    const log = el.shadowRoot!.querySelector('[part="messages"]')!;
    expect(log.textContent).toContain('pregunta de ayer');
    expect(log.textContent).toContain('respuesta de ayer');

    enviar(el, 'y hoy?');
    await new Promise((r) => setTimeout(r, 10));

    // El siguiente envío sigue en la MISMA conversación.
    expect(cliente.createConversation).not.toHaveBeenCalled();

    el.remove();
  });

  // Regresión: la sesión se reacuña (`auth.uid()` cambia) y el id guardado
  // deja de pertenecer a este visitante. `listMessages` falla con 404 y,
  // sin este descarte, el id se conservaba «a propósito» para siempre:
  // `#enviar` nunca volvía a llamar a `createConversation` y el widget
  // quedaba muerto con un 404 `project_not_found` en cada intento.
  it('con un 404 al recuperar el historial, descarta el id y crea una conversación nueva', async () => {
    localStorage.setItem(`tess:conversation:${PROYECTO}`, 'c-huerfana');

    const cliente = {
      createConversation: vi.fn(async () => ({ conversationId: 'c-nueva' })),
      listMessages: vi.fn(async () => {
        throw new TessHttpError('proyecto no encontrado', 404);
      }),
      getViewer: vi.fn(async () => ({
        userId: 'u1',
        isAnonymous: true,
        isProjectMember: false,
        lead: null,
        collectLeadsFromMembers: false,
      })),
      async *sendMessage() {
        yield { event: 'assistant.completed', data: { messageId: 'm1' } };
      },
    };

    const el = await montar(cliente, PROYECTO);
    await new Promise((r) => setTimeout(r, 10));

    // El id huérfano ya no está: `#restaurar` lo borró al ver el 404.
    expect(localStorage.getItem(`tess:conversation:${PROYECTO}`)).toBe(null);

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    expect(cliente.createConversation).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`tess:conversation:${PROYECTO}`)).toBe('c-nueva');

    el.remove();
  });

  // Un fallo transitorio (5xx, red) NO debe descartar el id: es justo el
  // caso que el gate pide recuperar al recargar la página.
  it('con un fallo de red al recuperar el historial, conserva el id guardado', async () => {
    localStorage.setItem(`tess:conversation:${PROYECTO}`, 'c-previa');

    const cliente = {
      createConversation: vi.fn(async () => ({ conversationId: 'c-nueva' })),
      listMessages: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
      getViewer: vi.fn(async () => ({
        userId: 'u1',
        isAnonymous: true,
        isProjectMember: false,
        lead: null,
        collectLeadsFromMembers: false,
      })),
      sendMessage: vi.fn(async function* () {
        yield { event: 'assistant.completed', data: { messageId: 'm1' } };
      }),
    };

    const el = await montar(cliente, PROYECTO);
    await new Promise((r) => setTimeout(r, 10));

    // El id sobrevive al fallo transitorio.
    expect(localStorage.getItem(`tess:conversation:${PROYECTO}`)).toBe('c-previa');

    enviar(el, 'hola');
    await new Promise((r) => setTimeout(r, 10));

    // No se crea una conversación nueva: sigue usándose la guardada.
    expect(cliente.createConversation).not.toHaveBeenCalled();
    expect(cliente.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c-previa' }),
    );

    el.remove();
  });
});
