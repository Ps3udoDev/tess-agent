import { describe, expect, it } from 'vitest';
import {
  extraer,
  FormatoNoSoportadoError,
  SinTextoError,
  PdfIlegibleError,
  MIMES_SOPORTADOS,
} from './index.js';
import { extraerPdf } from './pdf.js';

const codificar = (s: string) => new TextEncoder().encode(s);

/**
 * Arma un PDF mínimo pero válido: un objeto Catalog, Pages, Page, Font y un
 * stream de contenido con `texto`, con una tabla xref cuyos offsets se
 * calculan a partir de la longitud real de cada objeto (no a mano), para que
 * pdf.js lo lea sin tener que recuperarse de nada.
 */
function construirPdfValido(texto: string): Uint8Array {
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n';
  const obj4 =
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const contenido = `BT /F1 24 Tf 20 100 Td (${texto}) Tj ET`;
  const obj5 = `5 0 obj\n<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream\nendobj\n`;

  const offCatalog = header.length;
  const offPages = offCatalog + obj1.length;
  const offPage = offPages + obj2.length;
  const offFont = offPage + obj3.length;
  const offContent = offFont + obj4.length;
  const xrefOffset = offContent + obj5.length;

  const pad10 = (n: number) => n.toString().padStart(10, '0');

  const xref =
    'xref\n0 6\n' +
    '0000000000 65535 f \r\n' +
    `${pad10(offCatalog)} 00000 n \r\n` +
    `${pad10(offPages)} 00000 n \r\n` +
    `${pad10(offPage)} 00000 n \r\n` +
    `${pad10(offFont)} 00000 n \r\n` +
    `${pad10(offContent)} 00000 n \r\n`;

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return codificar(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer);
}

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

  it('devuelve el texto de un PDF válido', async () => {
    const pdf = construirPdfValido('Hola Tess');
    const texto = await extraer(pdf, 'application/pdf');
    expect(texto).toContain('Hola Tess');
  });

  it('un PDF ilegible rechaza con PdfIlegibleError dentro de un timeout pequeño inyectado', async () => {
    // Bytes que no son un PDF en absoluto: pdf.js falla su propia validación
    // de estructura casi de inmediato (con "Invalid PDF structure."), así
    // que el rechazo llega bien por debajo del timeout por defecto de 60s
    // incluso con uno pequeño como el inyectado aquí. La prueba de que el
    // temporizador en sí funciona -para una operación genuinamente colgada,
    // no para una que falla rápido- vive en pdf.test.ts con un doble de
    // pdf-parse: contra la librería real, verificado a mano, ni un
    // timeoutMs de 0 logra ganarle la carrera a getText() porque corre
    // como un único tramo síncrono (ver el reporte de la Tarea 10).
    const basura = new Uint8Array(200);
    for (let i = 0; i < basura.length; i++) basura[i] = (i * 37 + 11) % 256;

    await expect(extraerPdf(basura, 200)).rejects.toBeInstanceOf(
      PdfIlegibleError,
    );
  });
});
