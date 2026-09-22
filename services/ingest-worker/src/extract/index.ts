/**
 * Despacho por `mime_type`.
 *
 * Un formato no soportado es una RESPUESTA, no un fallo del servicio: el
 * llamante lo traduce a `failed` con su razón y el worker sigue vivo.
 */
import { extraerTexto } from './text.js';
import { extraerPdf } from './pdf.js';

// Reexportada junto al resto de errores tipados del módulo: la lanza
// extraerPdf() cuando pdf.js no puede procesar el archivo, por timeout o por
// cualquier fallo nativo de la librería (ver pdf.ts).
export { PdfIlegibleError } from './pdf.js';

export const MIMES_SOPORTADOS = [
  'application/pdf',
  'text/markdown',
  'text/plain',
] as const;

export class FormatoNoSoportadoError extends Error {
  constructor(mimeType: string) {
    super(`formato no soportado: ${mimeType}`);
    this.name = 'FormatoNoSoportadoError';
  }
}

export class SinTextoError extends Error {
  constructor() {
    super('sin texto extraíble; ¿es un PDF escaneado?');
    this.name = 'SinTextoError';
  }
}

export async function extraer(
  buffer: Uint8Array,
  mimeType: string,
): Promise<string> {
  // El parámetro puede venir como `text/plain; charset=utf-8`.
  const tipo = mimeType.split(';')[0]!.trim().toLowerCase();

  let texto: string;

  switch (tipo) {
    case 'application/pdf':
      texto = await extraerPdf(buffer);
      break;
    case 'text/markdown':
    case 'text/plain':
      texto = extraerTexto(buffer);
      break;
    default:
      throw new FormatoNoSoportadoError(tipo);
  }

  if (texto.trim().length === 0) throw new SinTextoError();

  return texto;
}
