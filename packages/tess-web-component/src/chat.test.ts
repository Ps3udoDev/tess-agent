import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatView } from './chat.js';

function raiz(): HTMLElement {
  const div = document.createElement('div');
  document.body.append(div);
  return div;
}

describe('createChatView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('pinta el log con role=log y aria-live=polite', () => {
    const vista = createChatView({
      root: raiz(),
      locale: 'es',
      onSend: vi.fn(),
    });
    vista.mount();

    const log = document.querySelector('[part="messages"]');
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('aria-live')).toBe('polite');
  });

  it('la burbuja en curso vive FUERA del log y con aria-busy', () => {
    const vista = createChatView({
      root: raiz(),
      locale: 'es',
      onSend: vi.fn(),
    });
    vista.mount();
    vista.beginStreaming();
    vista.pushDelta('hola ');

    const log = document.querySelector('[part="messages"]')!;
    const enCurso = document.querySelector('[part="streaming"]')!;

    // Si la burbuja mutara dentro del aria-live, el lector de pantalla
    // recitaría la respuesta letra a letra.
    expect(log.contains(enCurso)).toBe(false);
    expect(enCurso.getAttribute('aria-busy')).toBe('true');
    expect(enCurso.textContent).toBe('hola ');
  });

  it('al completar, el mensaje entra en el log ya entero', () => {
    const vista = createChatView({
      root: raiz(),
      locale: 'es',
      onSend: vi.fn(),
    });
    vista.mount();
    vista.beginStreaming();
    vista.pushDelta('hola ');
    vista.pushDelta('mundo');
    vista.commitStreaming();

    const log = document.querySelector('[part="messages"]')!;
    expect(log.textContent).toContain('hola mundo');
    expect(document.querySelector('[part="streaming"]')?.textContent).toBe('');
  });

  it('envía al hacer submit y limpia el campo', () => {
    const onSend = vi.fn();
    const vista = createChatView({ root: raiz(), locale: 'es', onSend });
    vista.mount();

    const campo = document.querySelector('textarea')!;
    campo.value = '  ¿qué ofrecen?  ';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(onSend).toHaveBeenCalledWith('¿qué ofrecen?');
    expect(campo.value).toBe('');
  });

  it('no envía un mensaje vacío', () => {
    const onSend = vi.fn();
    const vista = createChatView({ root: raiz(), locale: 'es', onSend });
    vista.mount();

    document.querySelector('textarea')!.value = '   ';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('anuncia el estado en una región viva aparte', () => {
    const vista = createChatView({
      root: raiz(),
      locale: 'es',
      onSend: vi.fn(),
    });
    vista.mount();
    vista.setStatus('thinking');

    const estado = document.querySelector('[part="status"]')!;
    expect(estado.getAttribute('aria-live')).toBe('polite');
    expect(estado.textContent).toBe('Pensando');
  });
});
