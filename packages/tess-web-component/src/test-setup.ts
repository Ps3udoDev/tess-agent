import { vi } from 'vitest';

class ObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

vi.stubGlobal('IntersectionObserver', ObserverStub);
vi.stubGlobal('ResizeObserver', ObserverStub);

// El runtime de Rive necesita WebGL/canvas real; en jsdom se mockea entero.
// Mock completo (sin importOriginal): cargar el módulo real arrastraría el
// runtime WASM de @rive-app/canvas dentro de jsdom. `element.ts` solo usa
// `mountTessRive` en tiempo de ejecución, así que es lo único que se mockea.
vi.mock('@teams4soft/tess-rive', () => ({
  mountTessRive: vi.fn(() => ({ greet: vi.fn(), destroy: vi.fn() })),
}));

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
