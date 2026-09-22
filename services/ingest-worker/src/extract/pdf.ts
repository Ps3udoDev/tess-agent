/**
 * PDF textual.
 *
 * Un PDF de solo imágenes extrae cadena vacía. Eso no es un fallo del
 * servicio: es un documento que no podemos ingerir, y el llamante lo convierte
 * en `failed` con una razón legible. OCR está fuera del alcance de F3.
 */
import { PDFParse } from 'pdf-parse';

/**
 * Tope de tiempo para extraer un PDF.
 *
 * Cubre el caso en que pdf.js queda esperando en un punto genuinamente
 * asíncrono (p. ej. E/S) al intentar recuperar la estructura de un PDF
 * corrupto. NO cubre un bloqueo síncrono del hilo de JS: verificado a mano
 * con un PDF malformado real, `getText()` corre como un único tramo síncrono
 * de principio a fin, así que ningún valor de `timeoutMs` (probado desde 0
 * hasta 60000) logra ganarle la carrera — el temporizador no tiene ocasión de
 * dispararse hasta que el bloqueo termina por sí solo. Ver el reporte de la
 * Tarea 10 para la evidencia. Es un parámetro con valor por defecto, no una
 * constante fija, para que los tests puedan inyectar un valor pequeño.
 */
export const EXTRACCION_PDF_TIMEOUT_MS = 60_000;

/**
 * El PDF no se pudo procesar: corrupto, con una tabla xref rota, una
 * estructura inválida, o porque excedió el tiempo permitido. El llamante
 * (extraer()) lo traduce a `failed` con una razón legible. Envuelve tanto el
 * timeout como cualquier excepción nativa de pdf.js, para que quien consuma
 * extraer() tenga un único tipo de error que reconocer y no dependa de los
 * tipos de excepción internos de la librería.
 */
export class PdfIlegibleError extends Error {
  constructor(motivo: string) {
    super(`el PDF no se pudo procesar: ${motivo}`);
    this.name = 'PdfIlegibleError';
  }
}

export async function extraerPdf(
  buffer: Uint8Array,
  timeoutMs: number = EXTRACCION_PDF_TIMEOUT_MS,
): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const extraccion = parser.getText();
  // Si el timeout gana la carrera, esta promesa sigue viva en segundo plano;
  // sin este catch mudo, un rechazo tardío sería un unhandled rejection.
  extraccion.catch(() => {});
  try {
    const resultado = await Promise.race([
      extraccion,
      new Promise<never>((_resolve, reject) => {
        temporizador = setTimeout(() => {
          reject(new PdfIlegibleError('tiempo de espera agotado'));
        }, timeoutMs);
      }),
    ]);
    return resultado.text;
  } catch (error) {
    if (error instanceof PdfIlegibleError) throw error;
    throw new PdfIlegibleError(error instanceof Error ? error.message : String(error));
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
    // Si el timeout ganó la carrera, getText() puede seguir corriendo en
    // segundo plano: destroy() libera el worker/documento de todos modos.
    await parser.destroy();
  }
}
