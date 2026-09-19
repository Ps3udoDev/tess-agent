import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './index.js';

function create(): HTMLElement & { state: string; destroy(): void } {
  const element = document.createElement(TAG_NAME) as HTMLElement & {
    state: string;
    destroy(): void;
  };
  document.body.append(element);
  return element;
}

beforeEach(async () => {
  await import('./element.js');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('teams4soft-assistant', () => {
  it('se registra como custom element', () => {
    expect(customElements.get(TAG_NAME)).toBeTypeOf('function');
  });

  it('monta un shadow root abierto con launcher accesible', () => {
    const element = create();
    const launcher = element.shadowRoot!.querySelector('button[part="launcher"]');
    expect(launcher).not.toBeNull();
    expect(launcher!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(launcher!.getAttribute('aria-expanded')).toBe('false');
    expect(launcher!.getAttribute('aria-label')).toBeTruthy();
  });

  it('refleja el atributo state en la propiedad', () => {
    const element = create();
    element.setAttribute('state', 'thinking');
    expect(element.state).toBe('thinking');
  });

  it('emite tess:state cuando el estado cambia', () => {
    const element = create();
    const seen = vi.fn();
    element.addEventListener('tess:state', seen);
    element.setAttribute('state', 'listening');
    expect(seen).toHaveBeenCalledTimes(1);
    const call = seen.mock.calls[0];
    expect(call).toBeDefined();
    expect((call?.[0] as CustomEvent).detail.state).toBe('listening');
  });

  it('usa las etiquetas del locale pedido', () => {
    const element = create();
    element.setAttribute('locale', 'en');
    const launcher = element.shadowRoot!.querySelector('button[part="launcher"]')!;
    expect(launcher.getAttribute('aria-label')).toBe('Open the Tess assistant');
  });

  it('cae al español si el locale no está soportado', () => {
    const element = create();
    element.setAttribute('locale', 'de');
    const launcher = element.shadowRoot!.querySelector('button[part="launcher"]')!;
    expect(launcher.getAttribute('aria-label')).toBe('Abrir el asistente Tess');
  });

  it('un size inválido cae a 96 y emite tess:error', () => {
    const element = create();
    const seen = vi.fn();
    element.addEventListener('tess:error', seen);
    element.setAttribute('size', '999');
    expect(element.getAttribute('size')).toBe('96');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('destroy deja el shadow root vacío y desconecta el core', () => {
    const element = create();
    element.destroy();
    expect(element.shadowRoot!.querySelector('button[part="launcher"]')).toBeNull();
  });
});
