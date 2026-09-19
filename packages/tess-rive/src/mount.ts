import { Alignment, Fit, Layout, Rive } from '@rive-app/canvas';
import type { TessCore, TessSnapshot } from '@teams4soft/tess-core';
import { ARTBOARD_NAME, RIVE_BOOLEANS, RIVE_TRIGGERS, STATE_MACHINE_NAME } from './contract.js';

export interface MountTessRiveOptions {
  canvas: HTMLCanvasElement;
  core: TessCore;
  /** Ruta al .riv. Por defecto, el asset empaquetado con este paquete. */
  src?: string;
  onError?: (error: Error) => void;
}

export interface TessRiveHandle {
  /** Saludo decorativo. No es un AssistantState. */
  greet(): void;
  destroy(): void;
}

const DEFAULT_SRC = new URL('../assets/teams4soft-tess.riv', import.meta.url).href;

interface RiveInput {
  name: string;
  value: boolean;
  fire(): void;
}

export function mountTessRive(options: MountTessRiveOptions): TessRiveHandle {
  const { canvas, core, src = DEFAULT_SRC } = options;
  const onError = options.onError ?? (() => {});

  let destroyed = false;
  let loaded = false;
  let inputs = new Map<string, RiveInput>();
  let previous: TessSnapshot | undefined;

  const rive = new Rive({
    canvas,
    src,
    artboard: ARTBOARD_NAME,
    stateMachines: STATE_MACHINE_NAME,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => {
      if (destroyed) return;
      inputs = new Map(
        (rive.stateMachineInputs(STATE_MACHINE_NAME) as RiveInput[]).map((input) => [
          input.name,
          input,
        ]),
      );
      loaded = true;
      apply(core.getSnapshot());
    },
    onLoadError: (event) =>
      onError(new Error(`No se pudo cargar el .riv: ${src}`, { cause: event })),
  });

  function bool(name: string, value: boolean): void {
    const input = inputs.get(name);
    if (input) input.value = value;
  }

  function fire(name: string): void {
    inputs.get(name)?.fire();
  }

  function apply(snapshot: TessSnapshot): void {
    // Antes de que el .riv termine de cargar, `inputs` está vacío: fijar
    // `value`/`fire()` no llega a ningún sitio. Si igual registráramos este
    // snapshot como `previous`, un trigger pedido en esa ventana (p. ej. un
    // atributo `state="success"` presente al primer parse del componente)
    // se perdería para siempre: al cargar, la comparación contra `previous`
    // vería el mismo estado y no lo dispararía. No tocar `previous` hasta
    // que haya inputs reales a los que aplicar el snapshot.
    if (!loaded) return;

    bool(RIVE_BOOLEANS.listening, snapshot.state === 'listening');
    bool(RIVE_BOOLEANS.thinking, snapshot.state === 'thinking');
    bool(RIVE_BOOLEANS.speaking, snapshot.state === 'speaking');
    bool(RIVE_BOOLEANS.reducedMotion, snapshot.reducedMotion);

    // Los triggers son de un disparo: solo al ENTRAR en el estado. Sin esta
    // comparación, un cambio de reducedMotion relanzaría la animación.
    if (snapshot.state !== previous?.state) {
      if (snapshot.state === 'success') fire(RIVE_TRIGGERS.success);
      else if (snapshot.state === 'error') fire(RIVE_TRIGGERS.error);
    }
    previous = snapshot;
  }

  const unsubscribe = core.subscribe(apply);

  // Pausa fuera de viewport: un avatar que no se ve no debe gastar frames.
  const viewport = new IntersectionObserver((entries) => {
    if (destroyed) return;
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible) rive.play();
    else rive.pause();
  });
  viewport.observe(canvas);

  // Nitidez en HiDPI: el buffer del canvas debe seguir a su tamaño en CSS.
  const resize = new ResizeObserver(() => {
    if (destroyed) return;
    rive.resizeDrawingSurfaceToCanvas();
  });
  resize.observe(canvas);

  return {
    greet: () => fire(RIVE_TRIGGERS.greet),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      viewport.disconnect();
      resize.disconnect();
      rive.cleanup();
    },
  };
}
