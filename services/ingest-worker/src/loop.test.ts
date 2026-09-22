import { describe, expect, it, vi } from 'vitest';
import { crearBucle } from './loop.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function doc(id: string) {
  return {
    id,
    organizationId: 'org',
    projectId: 'proj',
    title: id,
    mimeType: 'text/plain',
    storageBucket: 'b',
    storagePath: 'p',
  };
}

describe('crearBucle', () => {
  it('procesa los documentos pendientes y para al quedarse sin trabajo', async () => {
    const pendientes = [doc('a'), doc('b')];
    const procesados: string[] = [];

    const bucle = crearBucle({
      reclamar: async () => pendientes.shift() ?? null,
      procesar: async (d) => {
        procesados.push(d.id);
        return { estado: 'ready' as const, secciones: 1 };
      },
      intervaloMs: 5000,
      dormir: async () => bucle.parar(),
      log,
    });

    await bucle.arrancar();

    expect(procesados).toEqual(['a', 'b']);
  });

  it('con trabajo encadena sin dormir', async () => {
    const pendientes = [doc('a'), doc('b'), doc('c')];
    const dormir = vi.fn(async () => bucle.parar());

    const bucle = crearBucle({
      reclamar: async () => pendientes.shift() ?? null,
      procesar: async () => ({ estado: 'ready' as const, secciones: 1 }),
      intervaloMs: 5000,
      dormir,
      log,
    });

    await bucle.arrancar();

    // Una sola vez: la del final, cuando ya no quedaba trabajo.
    expect(dormir).toHaveBeenCalledTimes(1);
  });

  it('un error al reclamar no mata el bucle: duerme y reintenta', async () => {
    let intentos = 0;

    const bucle = crearBucle({
      reclamar: async () => {
        intentos += 1;
        if (intentos === 1) throw new Error('la base no responde');
        return null;
      },
      procesar: async () => ({ estado: 'ready' as const, secciones: 1 }),
      intervaloMs: 5000,
      dormir: async () => {
        if (intentos >= 2) bucle.parar();
      },
      log,
    });

    await bucle.arrancar();

    expect(intentos).toBe(2);
  });

  it('un documento fallido no detiene el procesamiento del siguiente', async () => {
    const pendientes = [doc('malo'), doc('bueno')];
    const procesados: string[] = [];

    const bucle = crearBucle({
      reclamar: async () => pendientes.shift() ?? null,
      procesar: async (d) => {
        procesados.push(d.id);
        return d.id === 'malo'
          ? { estado: 'failed' as const, secciones: 0, razon: 'formato' }
          : { estado: 'ready' as const, secciones: 3 };
      },
      intervaloMs: 5000,
      dormir: async () => bucle.parar(),
      log,
    });

    await bucle.arrancar();

    expect(procesados).toEqual(['malo', 'bueno']);
  });

  it('parar() detiene el bucle sin esperar al intervalo', async () => {
    const bucle = crearBucle({
      reclamar: async () => null,
      procesar: async () => ({ estado: 'ready' as const, secciones: 0 }),
      intervaloMs: 5000,
      dormir: async () => bucle.parar(),
      log,
    });

    const antes = Date.now();
    await bucle.arrancar();

    expect(Date.now() - antes).toBeLessThan(1000);
  });
});
