/**
 * Troceo estructural.
 *
 * Uno de los dos contratos que congela F3. Se parte por la estructura que el
 * documento ya tiene —encabezados, párrafos— y solo se corta por tokens cuando
 * un bloque por sí solo excede el tope.
 *
 * La razón es la cita. Una sección que empieza a media frase o que mezcla dos
 * encabezados produce una cita que no le dice nada a quien la lee.
 *
 * 700 y 80 son puntos de partida medidos con documentos de prueba, no una
 * garantía universal. Viven aquí como constantes y NO en el entorno a
 * propósito: cambiarlas invalida el índice y debe ser un commit revisable, no
 * una variable que alguien toca en Cloud Run.
 */

export const MAX_TOKENS = 700;
export const SOLAPE_TOKENS = 80;

export interface Chunk {
  ordinal: number;
  content: string;
  tokenCount: number;
  /** Ruta de encabezados que contiene la sección, de fuera a dentro. */
  headingPath: string[];
}

/**
 * Estimación de tokens.
 *
 * Deliberadamente aproximada: no se añade una dependencia de tokenización para
 * esto. El factor 1.3 se acerca a la relación palabra/token de los modelos
 * habituales en español e inglés. `token_count` es una métrica para dimensionar
 * el coste de contexto, no un valor de facturación.
 */
export function estimarTokens(texto: string): number {
  const limpio = texto.trim();
  if (limpio.length === 0) return 0;
  return Math.ceil(limpio.split(/\s+/).length * 1.3);
}

interface Bloque {
  headingPath: string[];
  parrafos: string[];
}

/** Parte el documento en bloques delimitados por encabezados Markdown. */
function partirEnBloques(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  const pila: string[] = [];
  let actual: Bloque = { headingPath: [], parrafos: [] };

  for (const parrafoCrudo of texto.split(/\n\s*\n/)) {
    const parrafo = parrafoCrudo.trim();
    if (parrafo.length === 0) continue;

    const encabezado = /^(#{1,6})\s+(.*)$/.exec(parrafo.split('\n')[0]!.trim());

    if (encabezado) {
      // Cierra el bloque anterior antes de cambiar de contexto.
      if (actual.parrafos.length > 0) bloques.push(actual);

      const nivel = encabezado[1]!.length;
      const titulo = encabezado[2]!.trim();

      pila.length = Math.min(pila.length, nivel - 1);
      pila[nivel - 1] = titulo;

      const ruta = pila.slice(0, nivel).filter((t): t is string => Boolean(t));
      actual = { headingPath: ruta, parrafos: [] };

      // El resto del párrafo, si el encabezado venía pegado a su texto.
      const resto = parrafo.split('\n').slice(1).join('\n').trim();
      if (resto.length > 0) actual.parrafos.push(resto);
      continue;
    }

    actual.parrafos.push(parrafo);
  }

  if (actual.parrafos.length > 0) bloques.push(actual);

  return bloques;
}

/** Corta un párrafo más largo que el tope, primero por frases y si no por palabras. */
function cortarParrafoLargo(parrafo: string): string[] {
  const frases = parrafo.match(/[^.!?]+[.!?]*\s*/g) ?? [parrafo];
  const piezas: string[] = [];
  let acumulado = '';

  for (const frase of frases) {
    if (estimarTokens(acumulado + frase) > MAX_TOKENS && acumulado.length > 0) {
      piezas.push(acumulado.trim());
      acumulado = '';
    }

    // Una sola frase mayor que el tope: se parte por palabras, que es el
    // último recurso y el único corte que puede caer a media idea.
    if (estimarTokens(frase) > MAX_TOKENS) {
      const palabras = frase.trim().split(/\s+/);
      const porPieza = Math.floor(MAX_TOKENS / 1.3);

      for (let i = 0; i < palabras.length; i += porPieza) {
        piezas.push(palabras.slice(i, i + porPieza).join(' '));
      }
      continue;
    }

    acumulado += frase;
  }

  if (acumulado.trim().length > 0) piezas.push(acumulado.trim());

  return piezas;
}

/** Las últimas palabras de un texto, hasta `SOLAPE_TOKENS`. */
function cola(texto: string): string {
  const palabras = texto.trim().split(/\s+/);
  const cuantas = Math.min(palabras.length, Math.floor(SOLAPE_TOKENS / 1.3));
  return palabras.slice(-cuantas).join(' ');
}

export function chunk(texto: string): Chunk[] {
  const secciones: Chunk[] = [];
  let ordinal = 0;

  for (const bloque of partirEnBloques(texto)) {
    // Los párrafos demasiado largos se trocean ANTES de acumular, para que el
    // acumulador solo tenga que preocuparse del tope.
    const piezas = bloque.parrafos.flatMap((p) =>
      estimarTokens(p) > MAX_TOKENS ? cortarParrafoLargo(p) : [p],
    );

    let acumulado = '';

    const emitir = () => {
      const contenido = acumulado.trim();
      if (contenido.length === 0) return;

      secciones.push({
        ordinal,
        content: contenido,
        tokenCount: estimarTokens(contenido),
        headingPath: bloque.headingPath,
      });
      ordinal += 1;
    };

    for (const pieza of piezas) {
      const candidato = acumulado.length === 0 ? pieza : `${acumulado}\n\n${pieza}`;

      if (estimarTokens(candidato) > MAX_TOKENS && acumulado.length > 0) {
        emitir();
        // El solape arranca la sección siguiente con la cola de la anterior,
        // para que una idea partida en dos siga siendo recuperable por
        // cualquiera de las dos mitades.
        const conSolape = `${cola(acumulado)}\n\n${pieza}`;
        if (estimarTokens(conSolape) > MAX_TOKENS) {
          // Si la pieza es muy grande, el solape la haría exceder el tope:
          // omitimos el solape en este caso.
          acumulado = pieza;
        } else {
          acumulado = conSolape;
        }
        continue;
      }

      acumulado = candidato;
    }

    emitir();
  }

  return secciones;
}
