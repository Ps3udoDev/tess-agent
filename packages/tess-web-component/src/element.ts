import { createNoopTessClient } from '@teams4soft/tess-client';
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
  type TessClientLike,
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
  #dialog: HTMLDialogElement | undefined;
  #fallback: HTMLSpanElement | undefined;
  #unsubscribe: (() => void) | undefined;
  #config: TessAssistantConfig = {};
  #client: TessClientLike = createNoopTessClient();

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

  /**
   * Punto de inyección congelado en Fase 1.
   *
   * Fase 2 solo sustituye la implementación: ni los atributos, ni los
   * métodos, ni los eventos de este elemento cambian por conectar el
   * backend real.
   */
  setClient(client: TessClientLike): void {
    this.#client = client;
  }

  /** Cliente actualmente inyectado (noop por defecto en Fase 1). */
  getClient(): TessClientLike {
    return this.#client;
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

    const dialog = document.createElement('dialog');
    dialog.setAttribute('part', 'dialog');
    dialog.setAttribute('aria-label', labelsFor(this.getAttribute('locale')).dialog);
    dialog.id = `tess-dialog-${Math.random().toString(36).slice(2, 8)}`;
    // El panel de conversación llega en Fase 2: aquí solo va la cáscara. Sin
    // `tabindex="-1"` el diálogo mismo no sería focosable, `openChat()` no
    // tendría dónde meter el foco (la cáscara no tiene nada focosable
    // todavía) y el listener de `keydown` de abajo, anclado al propio
    // diálogo, jamás recibiría un evento: el foco se quedaría en el
    // launcher, que es hermano del diálogo, no descendiente suyo.
    dialog.tabIndex = -1;
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeChat();
      }
    });
    launcher.setAttribute('aria-controls', dialog.id);
    launcher.addEventListener('click', () => {
      if (dialog.open) this.closeChat();
      else this.openChat();
    });
    this.#dialog = dialog;

    root.append(style, launcher, dialog);

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

  /**
   * Abre el diálogo con `show()`, no `showModal()`: la página sigue siendo
   * usable mientras el chat está abierto. Como consecuencia, Escape y el
   * retorno de foco al cerrar hay que gestionarlos a mano (ver `closeChat`
   * y el listener de `keydown` en `connectedCallback`).
   */
  openChat(): void {
    const dialog = this.#dialog;
    if (!dialog || dialog.open) return;
    dialog.show();
    this.#launcher?.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    this.#rive?.greet();
    // Si no hay nada focosable dentro (la cáscara de Fase 1), el foco entra
    // en el propio diálogo (ver `dialog.tabIndex = -1` más arriba). Sin esto
    // el foco se quedaría en el launcher y el Escape de abajo nunca llegaría
    // a su listener, que está anclado al diálogo.
    const focusTarget =
      dialog.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? dialog;
    focusTarget.focus();
    this.dispatchEvent(new CustomEvent('tess:open', { bubbles: true, composed: true }));
  }

  /** Cierra el diálogo y devuelve el foco al launcher que lo abrió. */
  closeChat(): void {
    const dialog = this.#dialog;
    if (!dialog || !dialog.open) return;
    dialog.close();
    this.#launcher?.setAttribute('aria-expanded', 'false');
    this.removeAttribute('open');
    this.#launcher?.focus();
    this.dispatchEvent(new CustomEvent('tess:close', { bubbles: true, composed: true }));
  }

  destroy(): void {
    this.#unsubscribe?.();
    this.#rive?.destroy();
    this.#core?.destroy();
    this.#unsubscribe = undefined;
    this.#rive = undefined;
    this.#core = undefined;
    this.#launcher = undefined;
    this.#dialog = undefined;
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
