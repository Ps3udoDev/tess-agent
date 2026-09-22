import { describe, expect, it } from 'vitest';
import { chunk, estimarTokens, MAX_TOKENS, SOLAPE_TOKENS } from './chunk.js';

/** Un párrafo de aproximadamente `tokens` tokens estimados. */
function parrafoDe(tokens: number, palabra = 'palabra'): string {
  const cuantas = Math.ceil(tokens / 1.3);
  return new Array(cuantas).fill(palabra).join(' ');
}

describe('chunk', () => {
  it('un documento vacío da cero secciones', () => {
    expect(chunk('')).toEqual([]);
    expect(chunk('   \n\n  ')).toEqual([]);
  });

  it('un documento corto es una sola sección', () => {
    const secciones = chunk(
      'Teams4Soft ofrece migración y soporte gestionado.',
    );
    expect(secciones).toHaveLength(1);
    expect(secciones[0]!.ordinal).toBe(0);
    expect(secciones[0]!.content).toContain('migración');
  });

  it('los ordinales son consecutivos desde cero', () => {
    const texto = [parrafoDe(600), parrafoDe(600), parrafoDe(600)].join('\n\n');
    const secciones = chunk(texto);

    expect(secciones.length).toBeGreaterThan(1);
    expect(secciones.map((s) => s.ordinal)).toEqual(secciones.map((_, i) => i));
  });

  it('ninguna sección supera el tope de tokens', () => {
    const texto = new Array(10).fill(parrafoDe(300)).join('\n\n');
    for (const seccion of chunk(texto)) {
      expect(seccion.tokenCount).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });

  it('NO cruza una frontera de encabezado', () => {
    // Dos secciones cortas bajo encabezados distintos caben de sobra juntas en
    // un chunk de 700 tokens, y aun así no deben mezclarse: la cita quedaría
    // apuntando a dos temas a la vez.
    const texto = [
      '# Servicios',
      '',
      'Ofrecemos migración a la nube.',
      '',
      '# Precios',
      '',
      'Los precios se cotizan por proyecto.',
    ].join('\n');

    const secciones = chunk(texto);

    expect(secciones).toHaveLength(2);
    expect(secciones[0]!.content).toContain('migración');
    expect(secciones[0]!.content).not.toContain('precios');
    expect(secciones[1]!.content).toContain('cotizan');
  });

  it('registra la ruta de encabezados de cada sección', () => {
    const texto = [
      '# Servicios',
      '',
      '## Migración',
      '',
      'Movemos cargas de trabajo a la nube.',
    ].join('\n');

    const secciones = chunk(texto);

    expect(secciones[0]!.headingPath).toEqual(['Servicios', 'Migración']);
  });

  it('secciones contiguas del mismo bloque se solapan', () => {
    const texto = [
      parrafoDe(400, 'alfa'),
      parrafoDe(400, 'beta'),
      parrafoDe(400, 'gamma'),
    ].join('\n\n');
    const secciones = chunk(texto);

    expect(secciones.length).toBeGreaterThan(1);

    // El final de una sección reaparece al principio de la siguiente.
    const colaDePrimera = secciones[0]!.content
      .trim()
      .split(/\s+/)
      .slice(-5)
      .join(' ');
    expect(secciones[1]!.content).toContain(colaDePrimera);
  });

  it('un único párrafo mayor que el tope se corta por tokens', () => {
    const secciones = chunk(parrafoDe(MAX_TOKENS * 3));

    expect(secciones.length).toBeGreaterThan(2);
    for (const seccion of secciones) {
      expect(seccion.tokenCount).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });

  it('el solape declarado es el que se usa', () => {
    expect(SOLAPE_TOKENS).toBe(80);
    expect(MAX_TOKENS).toBe(700);
  });

  it('no produce secciones vacías ni solo de espacios', () => {
    const texto = [
      '# Vacío',
      '',
      '',
      '# Con texto',
      '',
      'Aquí sí hay algo.',
    ].join('\n');
    for (const seccion of chunk(texto)) {
      expect(seccion.content.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('estimarTokens', () => {
  it('crece con la longitud y nunca es cero para texto no vacío', () => {
    expect(estimarTokens('')).toBe(0);
    expect(estimarTokens('una')).toBeGreaterThan(0);
    expect(
      estimarTokens('una frase bastante más larga que la anterior'),
    ).toBeGreaterThan(estimarTokens('una'));
  });
});
