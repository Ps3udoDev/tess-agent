import { describe, expect, it, vi } from 'vitest';
import { createLeadForm, debeMostrarLead } from './lead-form.js';

const BASE = {
  userId: 'u1',
  isAnonymous: true,
  isProjectMember: false,
  lead: null,
  collectLeadsFromMembers: false,
};

describe('debeMostrarLead', () => {
  it('lo muestra a un visitante anónimo sin lead', () => {
    expect(debeMostrarLead(BASE, false)).toBe(true);
  });

  it('lo muestra a un usuario registrado que no es miembro', () => {
    expect(debeMostrarLead({ ...BASE, isAnonymous: false }, false)).toBe(true);
  });

  it('NO lo muestra a un miembro del proyecto', () => {
    expect(debeMostrarLead({ ...BASE, isProjectMember: true }, false)).toBe(false);
  });

  it('lo muestra a un miembro solo si el proyecto lo pide expresamente', () => {
    expect(
      debeMostrarLead({ ...BASE, isProjectMember: true, collectLeadsFromMembers: true }, false),
    ).toBe(true);
  });

  it('NO lo muestra si ya hay lead', () => {
    expect(debeMostrarLead({ ...BASE, lead: { email: 'a@b.co' } }, false)).toBe(false);
  });

  it('NO lo muestra si se descartó localmente', () => {
    expect(debeMostrarLead(BASE, true)).toBe(false);
  });
});

describe('createLeadForm', () => {
  it('no envía sin correo ni nombre', () => {
    const root = document.createElement('div');
    document.body.append(root);

    const onSubmit = vi.fn();
    createLeadForm({
      root,
      locale: 'es',
      onSubmit,
      onDismiss: vi.fn(),
    }).mount();

    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();

    root.remove();
  });

  it('envía con solo el correo', () => {
    const root = document.createElement('div');
    document.body.append(root);

    const onSubmit = vi.fn();
    createLeadForm({
      root,
      locale: 'es',
      onSubmit,
      onDismiss: vi.fn(),
    }).mount();

    root.querySelector<HTMLInputElement>('input[type="email"]')!.value = 'ana@example.com';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@example.com' }));

    root.remove();
  });

  it('no se retira del DOM hasta que el envío resuelve', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    let resolver: () => void = () => {};
    const enVuelo = new Promise<void>((r) => {
      resolver = r;
    });

    createLeadForm({
      root,
      locale: 'es',
      onSubmit: () => enVuelo,
      onDismiss: vi.fn(),
    }).mount();

    root.querySelector<HTMLInputElement>('input[type="email"]')!.value = 'ana@example.com';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();

    // Todavía sin confirmar: el formulario sigue ahí.
    expect(root.querySelector('[part="lead"]')).not.toBeNull();

    resolver();
    await new Promise((r) => setTimeout(r, 0));

    expect(root.querySelector('[part="lead"]')).toBeNull();

    root.remove();
  });

  it('si el envío falla, lo dice y conserva lo escrito', async () => {
    const root = document.createElement('div');
    document.body.append(root);

    createLeadForm({
      root,
      locale: 'es',
      onSubmit: async () => {
        throw new Error('Failed to fetch');
      },
      onDismiss: vi.fn(),
    }).mount();

    const correo = root.querySelector<HTMLInputElement>('input[type="email"]')!;
    correo.value = 'ana@example.com';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Sigue en el DOM, con el correo intacto y el fallo anunciado.
    expect(root.querySelector('[part="lead"]')).not.toBeNull();
    expect(correo.value).toBe('ana@example.com');

    const aviso = root.querySelector<HTMLElement>('[part="lead-error"]')!;
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toBeTruthy();
    expect(aviso.getAttribute('role')).toBe('alert');

    root.remove();
  });

  it('incluye la nota de privacidad', () => {
    const root = document.createElement('div');
    document.body.append(root);

    createLeadForm({
      root,
      locale: 'es',
      onSubmit: vi.fn(),
      onDismiss: vi.fn(),
    }).mount();

    expect(root.querySelector('[part="lead-privacy"]')?.textContent).toBeTruthy();

    root.remove();
  });
});
