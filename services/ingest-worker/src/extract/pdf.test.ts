import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * `pdf-parse` real es síncrono y bloqueante durante `getText()` (verificado a
 * mano con un PDF corrupto: ni siquiera un `timeoutMs` de 0 logra ganarle la
 * carrera al `Promise.race` de `extraerPdf`, ver el reporte de la Tarea 10).
 * Por eso el mecanismo de timeout en sí —independiente del comportamiento
 * real de pdf.js— se prueba aquí contra un doble controlado: confirma que la
 * lógica de `extraerPdf` es correcta para cualquier operación genuinamente
 * asíncrona, aunque no pueda preemptar un bloqueo síncrono del hilo de JS.
 */
const { getTextMock, destroyMock } = vi.hoisted(() => ({
  getTextMock: vi.fn(),
  destroyMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(function PDFParseFalso() {
    return { getText: getTextMock, destroy: destroyMock };
  }),
}));

import { extraerPdf, PdfIlegibleError } from './pdf.js';

describe('extraerPdf (doble de pdf-parse)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('si getText() no resuelve a tiempo, rechaza con PdfIlegibleError sin esperar al valor por defecto', async () => {
    // Nunca resuelve: simula una operación asíncrona genuinamente colgada.
    getTextMock.mockReturnValue(new Promise(() => {}));

    const inicio = Date.now();
    await expect(extraerPdf(new Uint8Array(), 30)).rejects.toBeInstanceOf(PdfIlegibleError);
    // Muy por debajo de EXTRACCION_PDF_TIMEOUT_MS (60_000): prueba que se
    // usó el timeoutMs inyectado, no el valor por defecto.
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('si getText() rechaza con un error nativo de pdf.js, lo envuelve en PdfIlegibleError con el motivo', async () => {
    getTextMock.mockRejectedValue(new Error('Invalid PDF structure.'));

    await expect(extraerPdf(new Uint8Array(), 5000)).rejects.toThrow(/Invalid PDF structure/);
  });

  it('si getText() resuelve con texto, lo devuelve y libera el parser', async () => {
    getTextMock.mockResolvedValue({ text: 'contenido', pages: [], total: 1 });

    await expect(extraerPdf(new Uint8Array(), 5000)).resolves.toBe('contenido');
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
