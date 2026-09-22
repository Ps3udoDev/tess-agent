/**
 * El pipeline de un documento: descargar, extraer, trocear, embeber, persistir.
 *
 * Separado de `main.ts` a propósito: aquí no hay bucle ni señales, así que se
 * puede probar entero sin arrancar nada.
 *
 * La garantía: esta función NUNCA lanza y NUNCA deja el documento en
 * `processing`. Cualquier error se convierte en `failed` con razón saneada.
 * Un documento en `processing` no lo volvería a reclamar nadie.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '@teams4soft/tess-embeddings';
import type { DocumentoReclamado } from './claim.js';
import { marcarFallido, marcarListo, sanearRazon } from './claim.js';
import { extraer } from './extract/index.js';
import { chunk } from './chunk.js';
import { persistirSecciones } from './persist.js';

export interface Registro {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ProcesarInput {
  client: SupabaseClient;
  documento: DocumentoReclamado;
  embedder: EmbeddingProvider;
  bucket: string;
  dimensions: number;
  log: Registro;
}

export interface ResultadoProceso {
  estado: 'ready' | 'failed';
  secciones: number;
  razon?: string;
}

export async function procesarDocumento(
  input: ProcesarInput,
): Promise<ResultadoProceso> {
  const { client, documento, embedder, bucket, dimensions, log } = input;

  try {
    if (!documento.storagePath) {
      throw new Error('el documento no tiene storage_path');
    }

    const { data: blob, error: errDescarga } = await client.storage
      .from(documento.storageBucket ?? bucket)
      .download(documento.storagePath);

    if (errDescarga || !blob) {
      throw new Error(
        `no se pudo descargar: ${errDescarga?.message ?? 'sin contenido'}`,
      );
    }

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const texto = await extraer(
      buffer,
      documento.mimeType ?? 'application/octet-stream',
    );
    const secciones = chunk(texto);

    // El texto de las secciones NO va al log: es contenido del cliente.
    log.info(
      { documentId: documento.id, secciones: secciones.length },
      'documento troceado',
    );

    const vectores = await embedder.embedMany(secciones.map((s) => s.content));

    const escritas = await persistirSecciones({
      client,
      documento,
      chunks: secciones,
      vectores,
      model: embedder.model,
      dimensions,
    });

    await marcarListo(client, documento.id);

    log.info(
      { documentId: documento.id, secciones: escritas, model: embedder.model },
      'documento listo',
    );

    return { estado: 'ready', secciones: escritas };
  } catch (error) {
    const razon = sanearRazon(error);

    log.error(
      { documentId: documento.id, razon },
      'fallo al procesar documento',
    );

    try {
      await marcarFallido(client, documento.id, razon);
    } catch (fallo) {
      // Si ni el marcado de fallo funciona, el documento SÍ se queda en
      // `processing`. Es el único camino que lo permite, y por eso se registra
      // con un mensaje distinto: es lo que habría que buscar en los logs.
      log.error(
        { documentId: documento.id, err: sanearRazon(fallo) },
        'no se pudo marcar el documento como fallido; queda en processing',
      );
    }

    return { estado: 'failed', secciones: 0, razon };
  }
}
