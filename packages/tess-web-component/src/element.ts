import { createTessCore, type TessCore } from '@teams4soft/tess-core';
import { mountTessRive, type TessRiveHandle } from '@teams4soft/tess-rive';
import {
  DEFAULT_POSITION,
  DEFAULT_SIZE,
  POSITIONS,
  SIZES,
  THEMES,
  isRequestedState,
  type AssistantState,
  type RequestedState,
  type TessAssistantConfig,
  type TessErrorDetail,
  type TessPosition,
  type TessSize,
  type TessStateDetail,
  type TessTheme,
} from '@teams4soft/tess-types';
import { labelsFor } from './labels.js';
import { STYLES } from './styles.js';

export const TAG_NAME = 'teams4soft-assistant';

const OBSERVED = ['state', 'theme', 'size', 'position', 'api-url', 'locale'] as const;

export class TessAssistantElement extends HTMLElement {
  static readonly observedAttributes = OBSERVED;

  #core: TessCore | undefined;
  #rive: TessRiveHandle | undefined;
  #launcher: HTMLButtonElement | undefined;
  // Lo crea la Task 8; aquí se declara para que el manejador de `locale`
  // pueda actualizar su etiqueta sin referencias adelantadas.
  #dialog: HTMLDialogElement | undefined;
  #fallback: HTMLSpanElement | undefined;
  #unsubscribe: (() => void) | undefined;
  #config: TessAssistantConfig = {};

  // `state` conserva su semántica de lectura actual: expone el estado
  // EFECTIVO del core (puede diferir de lo pedido, p. ej. bajo `offline`).
  // El setter, en cambio, solo puede pedir un `RequestedState`: escribe el
  // atributo y deja que `attributeChangedCallback` reutilice su validación.
  get state(): AssistantState {
    return this.#core?.getSnapshot().state ?? 'idle';
  }

  set state(value: RequestedState) {
    this.setAttribute('state', value);
  }

  get theme(): TessTheme {
    const value = this.getAttribute('theme');
    return value !== null && THEMES.includes(value as TessTheme) ? (value as TessTheme) : 'auto';
  }

  set theme(value: TessTheme) {
    this.setAttribute('theme', value);
  }

  get size(): TessSize {
    const raw = Number(this.getAttribute('size'));
    return SIZES.includes(raw as TessSize) ? (raw as TessSize) : DEFAULT_SIZE;
  }

  set size(value: TessSize) {
    this.setAttribute('size', String(value));
  }

  get position(): TessPosition {
    const value = this.getAttribute('position');
    return value !== null && POSITIONS.includes(value as TessPosition)
      ? (value as TessPosition)
      : DEFAULT_POSITION;
  }

  set position(value: TessPosition) {
    this.setAttribute('position', value);
  }

  connectedCallback(): void {
    if (this.#core) return;
    if (!this.hasAttribute('theme')) this.setAttribute('theme', 'auto');
    if (!this.hasAttribute('size')) this.setAttribute('size', String(DEFAULT_SIZE));
    if (!this.hasAttribute('position')) this.setAttribute('position', DEFAULT_POSITION);

    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.setAttribute('part', 'launcher');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', labelsFor(this.getAttribute('locale')).launcher);

    const canvas = document.createElement('canvas');
    const fallback = document.createElement('span');
    fallback.className = 'fallback hidden';
    fallback.setAttribute('aria-hidden', 'true');
    launcher.append(canvas, fallback);

    root.append(style, launcher);

    this.#launcher = launcher;
    this.#fallback = fallback;
    this.#core = createTessCore({
      onError: (error) => this.#emitError('core', error),
    });
    this.#unsubscribe = this.#core.subscribe((snapshot) => {
      this.dispatchEvent(
        new CustomEvent<TessStateDetail>('tess:state', {
          detail: { state: snapshot.state },
          bubbles: true,
          composed: true,
        }),
      );
    });

    this.#rive = mountTessRive({
      canvas,
      core: this.#core,
      onError: (error) => {
        canvas.classList.add('hidden');
        this.#fallback?.classList.remove('hidden');
        this.#emitError('rive-load', error);
      },
    });

    // Se validan sin condición, no solo cuando faltaba el atributo: un
    // elemento parseado desde HTML recibe sus atributos (y por tanto
    // `attributeChangedCallback`) ANTES de `connectedCallback`, así que
    // `#core` todavía no existe cuando llega un valor inválido en el
    // marcado inicial y esa validación se pierde. Repetirla aquí, al final,
    // cierra esa ventana para los tres atributos con enum cerrado.
    this.#syncSize();
    this.#syncTheme();
    this.#syncPosition();
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (!this.#core) return;
    if (name === 'state' && value !== null) {
      if (isRequestedState(value)) this.#core.setState(value);
      else this.#emitError('bad-state', new Error(`Estado desconocido: ${value}`));
    }
    if (name === 'size') this.#syncSize();
    if (name === 'theme') this.#syncTheme();
    if (name === 'position') this.#syncPosition();
    if (name === 'api-url') {
      if (value === null) delete this.#config.apiUrl;
      else this.#config.apiUrl = value;
    }
    if (name === 'locale') {
      if (value === null) delete this.#config.locale;
      else this.#config.locale = value;
      const labels = labelsFor(value);
      this.#launcher?.setAttribute('aria-label', labels.launcher);
      this.#dialog?.setAttribute('aria-label', labels.dialog);
    }
  }

  destroy(): void {
    this.#unsubscribe?.();
    this.#rive?.destroy();
    this.#core?.destroy();
    this.#unsubscribe = undefined;
    this.#rive = undefined;
    this.#core = undefined;
    this.#launcher = undefined;
    this.#fallback = undefined;
    if (this.shadowRoot) this.shadowRoot.replaceChildren();
  }

  #syncSize(): void {
    const raw = Number(this.getAttribute('size'));
    if (!SIZES.includes(raw as TessSize)) {
      this.#emitError('bad-size', new Error(`Tamaño no soportado: ${this.getAttribute('size')}`));
      this.setAttribute('size', String(DEFAULT_SIZE));
      return;
    }
    this.style.setProperty('--tess-size', `${raw}px`);
  }

  #syncTheme(): void {
    const value = this.getAttribute('theme');
    if (value !== null && !THEMES.includes(value as TessTheme)) {
      this.setAttribute('theme', 'auto');
    }
  }

  #syncPosition(): void {
    const value = this.getAttribute('position');
    if (value !== null && !POSITIONS.includes(value as TessPosition)) {
      this.setAttribute('position', DEFAULT_POSITION);
    }
  }

  #emitError(code: string, error: Error): void {
    this.dispatchEvent(
      new CustomEvent<TessErrorDetail>('tess:error', {
        detail: { code, message: error.message },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, TessAssistantElement);
}
