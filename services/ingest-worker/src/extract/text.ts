/**
 * Texto plano y Markdown.
 *
 * El Markdown NO se convierte a texto: sus encabezados son justo lo que
 * `chunk()` usa para no cruzar fronteras de sección.
 */
export function extraerTexto(buffer: Uint8Array): string {
  return new TextDecoder('utf-8').decode(buffer);
}
