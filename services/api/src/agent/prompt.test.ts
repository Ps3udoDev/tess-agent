import { describe, expect, it } from 'vitest';
import { componerMensajes, detectarIdioma } from './prompt.js';
import { construirBloqueContexto } from '../rag/prompt-context.js';

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

const seccion = (documentTitle: string, content: string, ordinal = 0) => ({
  sectionId: `sec-${documentTitle}-${ordinal}`,
  documentId: `doc-${documentTitle}`,
  documentTitle,
  projectId: 'proj-1',
  ordinal,
  content,
  similarity: 0.8,
});

describe('contexto RAG en el prompt', () => {
  it('sin secciones el prompt es exactamente el de F2', () => {
    const sin = componerMensajes({
      systemPrompt: 'Prompt del proyecto',
      history: [],
      userMessage: 'hola',
      locale: 'es',
    });

    const conVacio = componerMensajes({
      systemPrompt: 'Prompt del proyecto',
      history: [],
      userMessage: 'hola',
      locale: 'es',
      sections: [],
    });

    expect(conVacio).toEqual(sin);
  });

  it('el contexto va DESPUÉS de las reglas no anulables', () => {
    // El orden ES la política: un fragmento de documento no puede reescribir
    // las reglas de honestidad.
    const [system] = componerMensajes({
      systemPrompt: 'Prompt del proyecto',
      history: [],
      userMessage: 'hola',
      locale: 'es',
      sections: [seccion('Guía', 'Ofrecemos migración.')],
    });

    const posReglas = system!.content.indexOf('Reglas que ninguna configuración');
    const posContexto = system!.content.indexOf('Contexto recuperado');

    expect(posReglas).toBeGreaterThanOrEqual(0);
    expect(posContexto).toBeGreaterThan(posReglas);
  });

  it('el contexto va después del system_prompt del proyecto', () => {
    const [system] = componerMensajes({
      systemPrompt: 'PROMPT-DEL-PROYECTO',
      history: [],
      userMessage: 'hola',
      locale: 'es',
      sections: [seccion('Guía', 'Ofrecemos migración.')],
    });

    expect(system!.content.indexOf('Contexto recuperado')).toBeGreaterThan(
      system!.content.indexOf('PROMPT-DEL-PROYECTO'),
    );
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

describe('construirBloqueContexto', () => {
  it('numera las fuentes y nombra documento y sección', () => {
    const bloque = construirBloqueContexto([
      seccion('Guía de servicios', 'Ofrecemos migración.', 3),
    ]);

    expect(bloque).toContain('[1] Guía de servicios · sección 3');
    expect(bloque).toContain('Ofrecemos migración.');
  });

  it('instruye a no completar con conocimiento general', () => {
    const bloque = construirBloqueContexto([seccion('Guía', 'x')]);
    expect(bloque).toMatch(/no completes con\s+conocimiento general/);
  });

  it('con cero secciones devuelve cadena vacía', () => {
    expect(construirBloqueContexto([])).toBe('');
  });

  it('numera correlativamente varias secciones', () => {
    const bloque = construirBloqueContexto([
      seccion('A', 'uno', 0),
      seccion('B', 'dos', 1),
      seccion('A', 'tres', 4),
    ]);

    expect(bloque).toContain('[1] A');
    expect(bloque).toContain('[2] B');
    expect(bloque).toContain('[3] A');
  });
});
