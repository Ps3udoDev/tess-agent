import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatView, type ChatView } from './chat.js';

function raiz(): HTMLElement {
  const div = document.createElement('div');
  document.body.append(div);
  return div;
}

function montarChat(): ChatView {
  const vista = createChatView({
    root: raiz(),
    locale: 'es',
    onSend: vi.fn(),
  });
  vista.mount();
  return vista;
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

describe('citas', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('las fuentes recibidas durante el stream se pintan con el mensaje', () => {
    const vista = montarChat();

    vista.beginStreaming();
    vista.pushSource({ title: 'Guía de servicios', documentId: 'doc-1' });
    vista.pushDelta('Ofrecemos migración.');
    vista.commitStreaming();

    const raiz = document.querySelector('[part="messages"]')!;
    expect(raiz.textContent).toContain('Guía de servicios');
  });

  it('deduplica si llega dos veces el mismo documento', () => {
    const vista = montarChat();

    vista.beginStreaming();
    vista.pushSource({ title: 'Guía', documentId: 'doc-1' });
    vista.pushSource({ title: 'Guía', documentId: 'doc-1' });
    vista.pushDelta('x');
    vista.commitStreaming();

    expect(document.querySelectorAll('[part="source"]')).toHaveLength(1);
  });

  it('sin fuentes no pinta la lista', () => {
    const vista = montarChat();

    vista.beginStreaming();
    vista.pushDelta('Hola.');
    vista.commitStreaming();

    expect(document.querySelector('[part="sources"]')).toBeNull();
  });

  it('las fuentes del turno anterior no se arrastran al siguiente', () => {
    const vista = montarChat();

    vista.beginStreaming();
    vista.pushSource({ title: 'Guía', documentId: 'doc-1' });
    vista.pushDelta('Primera.');
    vista.commitStreaming();

    vista.beginStreaming();
    vista.pushDelta('Segunda, sin fuentes.');
    vista.commitStreaming();

    const mensajes = document.querySelectorAll('[part="message"]');
    expect(mensajes[mensajes.length - 1]!.querySelector('[part="sources"]')).toBeNull();
  });

  it('las citas van DENTRO del mensaje, no en una región viva aparte', () => {
    // El log ya es aria-live: si las citas vivieran fuera, el lector las
    // anunciaría sueltas y sin contexto.
    const vista = montarChat();

    vista.beginStreaming();
    vista.pushSource({ title: 'Guía', documentId: 'doc-1' });
    vista.pushDelta('x');
    vista.commitStreaming();

    const mensaje = document.querySelector('[part="message"]')!;
    expect(mensaje.querySelector('[part="sources"]')).not.toBeNull();
  });

  it('append pinta las fuentes del historial recargado', () => {
    const vista = montarChat();

    vista.append('assistant', 'Respuesta previa.', [{ title: 'Guía', documentId: 'doc-1' }]);

    expect(document.querySelector('[part="sources"]')!.textContent).toContain('Guía');
  });
});
