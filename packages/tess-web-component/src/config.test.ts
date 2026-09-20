import { beforeAll, describe, expect, it } from 'vitest';
import { TAG_NAME } from '@teams4soft/tess-types';
import './index.js';

function montar(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(TAG_NAME);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

describe('configuración del cliente', () => {
  beforeAll(() => {
    document.body.innerHTML = '';
  });

  it('observa project-id y public-key', () => {
    const observados = (
      customElements.get(TAG_NAME) as unknown as {
        observedAttributes: string[];
      }
    ).observedAttributes;

    expect(observados).toContain('project-id');
    expect(observados).toContain('public-key');
  });

  it('no construye cliente sin los tres datos', () => {
    const el = montar({ 'project-id': 'p1' }) as HTMLElement & {
      hasRealClient(): boolean;
    };
    expect(el.hasRealClient()).toBe(false);
    el.remove();
  });

  it('construye cliente con api-url, project-id y public-key', () => {
    const el = montar({
      'api-url': 'https://api.example',
      'project-id': '11111111-1111-1111-1111-111111111111',
      'public-key': 'pk_dev_tess_local_0001',
    }) as HTMLElement & { hasRealClient(): boolean };

    expect(el.hasRealClient()).toBe(true);
    el.remove();
  });

  it('setClient() tiene prioridad sobre la construcción automática', () => {
    const el = montar({
      'api-url': 'https://api.example',
      'project-id': '11111111-1111-1111-1111-111111111111',
      'public-key': 'pk_dev_tess_local_0001',
    }) as HTMLElement & {
      setClient(c: unknown): void;
      getClient(): unknown;
    };

    const mio = { async *sendMessage() {} };
    el.setClient(mio);

    expect(el.getClient()).toBe(mio);
    el.remove();
  });
});
