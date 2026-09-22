/**
 * El bucle de trabajo.
 *
 * Con trabajo, encadena sin dormir. Sin trabajo, duerme el intervalo con
 * jitter y reintenta. El jitter importa con varias instancias: sin él,
 * arrancarlas a la vez las sincroniza y todas sondean en el mismo instante.
 *
 * Un error al reclamar NO mata el bucle. La base puede estar reiniciándose, y
 * un worker que muere por eso deja la cola parada hasta que alguien lo note.
 *
 * `dormir` es inyectable para que los tests no esperen segundos de verdad.
 */
import type { DocumentoReclamado } from './claim.js';
import type { Registro, ResultadoProceso } from './process.js';

export interface BucleInput {
  reclamar(): Promise<DocumentoReclamado | null>;
  procesar(documento: DocumentoReclamado): Promise<ResultadoProceso>;
  intervaloMs: number;
  dormir?: (ms: number) => Promise<void>;
  log: Registro;
}

export interface Bucle {
  arrancar(): Promise<void>;
  parar(): void;
}

function dormirDeVerdad(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

export function crearBucle(input: BucleInput): Bucle {
  const dormir = input.dormir ?? dormirDeVerdad;
  let corriendo = true;

  return {
    parar() {
      corriendo = false;
    },

    async arrancar() {
      while (corriendo) {
        // Sin inicializador: `no-useless-assignment` marca un `= null` aquí
        // porque, tras el `try`, o `documento` ya quedó reasignado, o el
        // `catch` hizo `continue` antes de que se llegara a leer.
        let documento: DocumentoReclamado | null;

        try {
          documento = await input.reclamar();
        } catch (error) {
          input.log.error(
            { err: error instanceof Error ? error.message : String(error) },
            'fallo al reclamar documento; se reintenta tras el intervalo',
          );
          // Entre 0.5x y 1.5x del intervalo: evita que N instancias que
          // arrancaron juntas sondeen siempre en el mismo instante.
          await dormir(input.intervaloMs * (0.5 + Math.random()));
          continue;
        }

        if (!documento) {
          await dormir(input.intervaloMs * (0.5 + Math.random()));
          continue;
        }

        // `procesar` no lanza por contrato (ver process.ts), pero el bucle no
        // se apoya en esa promesa: si algún día lo hiciera, el worker seguiría.
        try {
          const resultado = await input.procesar(documento);

          input.log.info(
            {
              documentId: documento.id,
              estado: resultado.estado,
              secciones: resultado.secciones,
            },
            'documento procesado',
          );
        } catch (error) {
          input.log.error(
            {
              documentId: documento.id,
              err: error instanceof Error ? error.message : String(error),
            },
            'el pipeline lanzó pese a su contrato',
          );
        }
      }
    },
  };
}
