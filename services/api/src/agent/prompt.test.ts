import { describe, expect, it } from 'vitest';
import { componerMensajes, detectarIdioma } from './prompt.js';

describe('detectarIdioma', () => {
  it('detecta español', () => {
    expect(detectarIdioma('¿Qué servicios de migración ofrecen?', 'en-US')).toBe('es');
  });

  it('detecta inglés', () => {
    expect(detectarIdioma('What migration services do you offer?', 'es-MX')).toBe('en');
  });

  it('detecta portugués', () => {
    expect(detectarIdioma('Quais serviços de migração vocês oferecem?', 'es-MX')).toBe('pt');
  });

  it('cae al locale cuando el mensaje es ambiguo', () => {
    expect(detectarIdioma('ok', 'es-MX')).toBe('es-MX');
    expect(detectarIdioma('ok', 'en-US')).toBe('en-US');
  });

  it('cae a es-MX sin locale', () => {
    expect(detectarIdioma('ok', undefined)).toBe('es-MX');
  });
});

describe('componerMensajes', () => {
  const base = {
    systemPrompt: 'Prompt del proyecto: habla de bodas.',
    history: [{ role: 'user' as const, content: 'hola' }],
    userMessage: 'What do you offer?',
    locale: 'es-MX',
  };

  it('pone las reglas de seguridad antes del prompt del proyecto', () => {
    const mensajes = componerMensajes(base);
    const system = mensajes[0]?.content ?? '';

    const posicionSeguridad = system.indexOf('No inventes');
    const posicionProyecto = system.indexOf('habla de bodas');

    expect(posicionSeguridad).toBeGreaterThanOrEqual(0);
    expect(posicionProyecto).toBeGreaterThan(posicionSeguridad);
  });

  it('inyecta la instrucción de idioma del mensaje, no la del locale', () => {
    const system = componerMensajes(base)[0]?.content ?? '';
    expect(system).toContain('Responde en: en');
  });

  it('termina con el mensaje del usuario', () => {
    const mensajes = componerMensajes(base);
    expect(mensajes.at(-1)).toEqual({
      role: 'user',
      content: 'What do you offer?',
    });
  });

  it('recorta el historial a los últimos 20 turnos', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));

    const mensajes = componerMensajes({ ...base, history });

    // 1 system + 20 de historial + 1 del usuario.
    expect(mensajes.length).toBe(22);
    expect(mensajes[1]?.content).toBe('m20');
  });
});
