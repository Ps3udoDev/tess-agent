import { describe, expect, it } from 'vitest';
import {
  extraer,
  FormatoNoSoportadoError,
  SinTextoError,
  MIMES_SOPORTADOS,
} from './index.js';

const codificar = (s: string) => new TextEncoder().encode(s);

describe('extraer', () => {
  it('devuelve el texto de un .txt tal cual', async () => {
    const texto = await extraer(
      codificar('Hola desde un archivo de texto.'),
      'text/plain',
    );
    expect(texto).toContain('archivo de texto');
  });

  it('devuelve el Markdown sin convertirlo', async () => {
    // Los encabezados se conservan a propósito: chunk() los usa para no cruzar
    // fronteras de sección.
    const texto = await extraer(
      codificar('# Servicios\n\nMigración a la nube.'),
      'text/markdown',
    );
    expect(texto).toContain('# Servicios');
  });

  it('rechaza un mime no soportado con un error tipado', async () => {
    await expect(
      extraer(codificar('x'), 'application/zip'),
    ).rejects.toBeInstanceOf(FormatoNoSoportadoError);
  });

  it('el mensaje del formato no soportado nombra el formato', async () => {
    await expect(extraer(codificar('x'), 'application/zip')).rejects.toThrow(
      /application\/zip/,
    );
  });

  it('un archivo sin texto extraíble da SinTextoError', async () => {
    await expect(
      extraer(codificar('   \n  \n '), 'text/plain'),
    ).rejects.toBeInstanceOf(SinTextoError);
  });

  it('la lista de mimes soportados es la del spec', () => {
    expect([...MIMES_SOPORTADOS].sort()).toEqual(
      ['application/pdf', 'text/markdown', 'text/plain'].sort(),
    );
  });
});
