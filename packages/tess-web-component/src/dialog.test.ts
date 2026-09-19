import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './index.js';

type Element = HTMLElement & { openChat(): void; closeChat(): void };

function create(): Element {
  const element = document.createElement(TAG_NAME) as Element;
  document.body.append(element);
  return element;
}

beforeEach(async () => {
  await import('./element.js');
  // jsdom no implementa show()/close() de <dialog>.
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('diálogo no modal', () => {
  it('abre con show(), no con showModal()', () => {
    const element = create();
    const dialog = element.shadowRoot!.querySelector('dialog')!;
    const showModal = vi.fn();
    dialog.showModal = showModal;
    element.openChat();
    expect(dialog.open).toBe(true);
    expect(showModal).not.toHaveBeenCalled();
  });

  it('actualiza aria-expanded del launcher', () => {
    const element = create();
    const launcher = element.shadowRoot!.querySelector('button[part="launcher"]')!;
    element.openChat();
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    element.closeChat();
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
  });

  it('emite tess:open y tess:close', () => {
    const element = create();
    const opened = vi.fn();
    const closed = vi.fn();
    element.addEventListener('tess:open', opened);
    element.addEventListener('tess:close', closed);
    element.openChat();
    element.closeChat();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('cierra con Escape', () => {
    const element = create();
    const dialog = element.shadowRoot!.querySelector('dialog')!;
    element.openChat();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.open).toBe(false);
  });

  it('devuelve el foco al launcher al cerrar', () => {
    const element = create();
    const launcher =
      element.shadowRoot!.querySelector<HTMLButtonElement>('button[part="launcher"]')!;
    const focus = vi.spyOn(launcher, 'focus');
    element.openChat();
    element.closeChat();
    expect(focus).toHaveBeenCalled();
  });

  it('abrir dos veces no duplica eventos', () => {
    const element = create();
    const opened = vi.fn();
    element.addEventListener('tess:open', opened);
    element.openChat();
    element.openChat();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
