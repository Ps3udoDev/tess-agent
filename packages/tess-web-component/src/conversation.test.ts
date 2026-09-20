import { describe, expect, it, vi } from 'vitest';
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
    // eslint-disable-next-line require-await
    async *sendMessage() {
      for (const e of eventos) yield e;
    },
  };
}

async function montarConCliente(eventos: AssistantStreamEvent[]) {
  const el = document.createElement(TAG_NAME) as HTMLElement & {
    setClient(c: unknown): void;
    openChat(): void;
  };
  document.body.append(el);
  el.setClient(clienteFalso(eventos));
  el.openChat();
  await new Promise((r) => setTimeout(r, 0));
  return el;
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
