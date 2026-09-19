import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as tessCoreModule from '@teams4soft/tess-core';
import { mountTessRive } from '@teams4soft/tess-rive';
import type {
  AssistantStreamEvent,
  SendMessageInput,
  TessClientLike,
  TessPosition,
  TessSize,
  TessTheme,
} from '@teams4soft/tess-types';
import { TAG_NAME } from './index.js';

type TessAssistantTestElement = HTMLElement & {
  state: string;
  theme: TessTheme;
  size: TessSize;
  position: TessPosition;
  destroy(): void;
  setClient(client: TessClientLike): void;
  getClient(): TessClientLike;
};

function create(): TessAssistantTestElement {
  const element = document.createElement(TAG_NAME) as TessAssistantTestElement;
  document.body.append(element);
  return element;
}

/** Crea el elemento SIN conectarlo, para reproducir el orden de "upgrade":
 * un custom element parseado desde HTML recibe sus atributos (y por tanto
 * `attributeChangedCallback`) antes de `connectedCallback`. */
function createDisconnected(): TessAssistantTestElement {
  return document.createElement(TAG_NAME) as TessAssistantTestElement;
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

  it('destroy detiene el core y el avatar Rive, y deja el shadow root vacío', () => {
    // Se envuelve `createTessCore` real (no el módulo mockeado, que es solo
    // tess-rive) para comprobar que `destroy()` realmente apaga el core, no
    // solo que la referencia local queda en `undefined`.
    const originalCreateTessCore = tessCoreModule.createTessCore;
    let capturedCore: ReturnType<typeof originalCreateTessCore> | undefined;
    const createTessCoreSpy = vi
      .spyOn(tessCoreModule, 'createTessCore')
      .mockImplementation((options) => {
        const core = originalCreateTessCore(options);
        vi.spyOn(core, 'destroy');
        capturedCore = core;
        return core;
      });

    const element = create();
    const canvas = element.shadowRoot!.querySelector('canvas');
    const riveCallIndex = vi
      .mocked(mountTessRive)
      .mock.calls.findIndex((entry) => entry[0]?.canvas === canvas);
    const riveHandle = vi.mocked(mountTessRive).mock.results[riveCallIndex]?.value;

    element.destroy();

    expect(element.shadowRoot!.querySelector('button[part="launcher"]')).toBeNull();
    expect(capturedCore?.destroy).toHaveBeenCalledTimes(1);
    expect(riveHandle?.destroy).toHaveBeenCalledTimes(1);

    createTessCoreSpy.mockRestore();
  });

  it('expone theme, size y position como propiedades reflejadas al atributo', () => {
    const element = create();

    element.theme = 'dark';
    expect(element.getAttribute('theme')).toBe('dark');
    expect(element.theme).toBe('dark');

    element.size = 128;
    expect(element.getAttribute('size')).toBe('128');
    expect(element.size).toBe(128);

    element.position = 'top-left';
    expect(element.getAttribute('position')).toBe('top-left');
    expect(element.position).toBe('top-left');
  });

  it('state también admite escritura como propiedad', () => {
    const element = create();
    element.state = 'speaking';
    expect(element.getAttribute('state')).toBe('speaking');
    expect(element.state).toBe('speaking');
  });

  it('monta el avatar Rive en el canvas del launcher', () => {
    const element = create();
    const canvas = element.shadowRoot!.querySelector('canvas');
    expect(canvas).not.toBeNull();

    const calls = vi.mocked(mountTessRive).mock.calls;
    const call = calls.find((entry) => entry[0]?.canvas === canvas);
    expect(call).toBeDefined();
    expect(call?.[0]).toEqual(expect.objectContaining({ canvas, core: expect.any(Object) }));
  });

  it('normaliza un theme inválido presente antes de conectar (orden de upgrade)', () => {
    const element = createDisconnected();
    element.setAttribute('theme', 'bogus');
    document.body.append(element);
    expect(element.getAttribute('theme')).toBe('auto');
  });

  it('normaliza un position inválido presente antes de conectar (orden de upgrade)', () => {
    const element = createDisconnected();
    element.setAttribute('position', 'middle-of-nowhere');
    document.body.append(element);
    expect(element.getAttribute('position')).toBe('bottom-right');
  });

  it('empieza con un cliente noop y setClient sustituye la instancia inyectada', async () => {
    const element = create();
    const initial = element.getClient();
    const received: AssistantStreamEvent[] = [];
    for await (const event of initial.sendMessage({ conversationId: 'c1', text: 'hola' })) {
      received.push(event);
    }
    expect(received).toEqual([]);

    const fakeClient: TessClientLike = {
      // eslint-disable-next-line require-yield -- doble de prueba, no emite eventos.
      async *sendMessage(_input: SendMessageInput) {
        return;
      },
    };
    element.setClient(fakeClient);
    expect(element.getClient()).toBe(fakeClient);
  });
});
