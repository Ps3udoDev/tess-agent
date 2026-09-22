/**
 * PDF textual.
 *
 * Un PDF de solo imágenes extrae cadena vacía. Eso no es un fallo del
 * servicio: es un documento que no podemos ingerir, y el llamante lo convierte
 * en `failed` con una razón legible. OCR está fuera del alcance de F3.
 */
import { PDFParse } from 'pdf-parse';

export async function extraerPdf(buffer: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getText();
    return resultado.text;
  } finally {
    await parser.destroy();
  }
}
