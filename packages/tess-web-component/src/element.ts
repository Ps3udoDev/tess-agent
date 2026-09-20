import { createNoopTessClient, createTessClient, TessHttpError } from '@teams4soft/tess-client';
import { createTessCore, type TessCore } from '@teams4soft/tess-core';
import { mountTessRive, type TessRiveHandle } from '@teams4soft/tess-rive';
import {
  DEFAULT_POSITION,
  DEFAULT_SIZE,
  POSITIONS,
  SIZES,
  TAG_NAME,
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
  type TessViewer,
} from '@teams4soft/tess-types';
import { createChatView, type ChatView } from './chat.js';
import { labelsFor } from './labels.js';
import { createLeadForm, debeMostrarLead, type LeadForm } from './lead-form.js';
import { STYLES } from './styles.js';

const OBSERVED = [
  'state',
  'theme',
  'size',
  'position',
  'api-url',
  'project-id',
  'public-key',
  'locale',
] as const;

const BaseElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

export class TessAssistantElement extends BaseElement {
  static readonly observedAttributes = OBSERVED;

  #core: TessCore | undefined;
  #rive: TessRiveHandle | undefined;
  #launcher: HTMLButtonElement | undefined;
  #dialog: HTMLDialogElement | undefined;
  #fallback: HTMLSpanElement | undefined;
  #unsubscribe: (() => void) | undefined;
  #config: TessAssistantConfig = {};
  readonly #noopClient: TessClientLike = createNoopTessClient();
  #client: TessClientLike = this.#noopClient;
  #clientInjected = false;
  #publicKey: string | undefined;
  #chat: ChatView | undefined;
  #conversationId: string | undefined;
  #enviando = false;
  #viewer: TessViewer | undefined;
  #leadForm: LeadForm | undefined;
  #restaurando: Promise<void> | undefined;

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
    this.#clientInjected = true;
    this.#client = client;
  }

  /** Cliente actualmente inyectado (noop por defecto en Fase 1). */
  getClient(): TessClientLike {
    return this.#client;
  }

  /** Solo para tests: indica si el cliente es el real o el noop. */
  hasRealClient(): boolean {
    return this.#client !== this.#noopClient;
  }

  /**
   * Construye el cliente real cuando están los tres datos.
   *
   * `setClient()` tiene prioridad: si el integrador inyectó el suyo, el
   * componente no construye nada.
   */
  #maybeCreateClient(): void {
    if (this.#clientInjected) return;

    const { apiUrl, projectId } = this.#config;
    if (!apiUrl || !projectId || !this.#publicKey) return;

    this.#client = createTessClient({
      apiUrl,
      projectId,
      publicKey: this.#publicKey,
    });
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
    if (name === 'api-url') {
      if (value === null) delete this.#config.apiUrl;
      else this.#config.apiUrl = value;
      this.#maybeCreateClient();
      return;
    }
    if (name === 'project-id') {
      if (value === null) delete this.#config.projectId;
      else this.#config.projectId = value;
      this.#maybeCreateClient();
      return;
    }
    if (name === 'public-key') {
      this.#publicKey = value ?? undefined;
      this.#maybeCreateClient();
      return;
    }
    if (name === 'locale') {
      if (value === null) delete this.#config.locale;
      else this.#config.locale = value;
      const labels = labelsFor(value);
      this.#launcher?.setAttribute('aria-label', labels.launcher);
      this.#dialog?.setAttribute('aria-label', labels.dialog);
      return;
    }

    if (!this.#core) return;
    if (name === 'state' && value !== null) {
      if (isRequestedState(value)) this.#core.setState(value);
      else this.#emitError('bad-state', new Error(`Estado desconocido: ${value}`));
    }
    if (name === 'size') this.#syncSize();
    if (name === 'theme') this.#syncTheme();
    if (name === 'position') this.#syncPosition();
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

    if (!this.#chat) {
      this.#chat = createChatView({
        root: this.#dialog!,
        locale: this.#config.locale ?? 'es',
        onSend: (texto) => void this.#enviar(texto),
      });
      this.#chat.mount();

      const saludo = (this.#client as { getGreeting?(): string | null }).getGreeting?.();
      if (saludo) this.#chat.append('assistant', saludo);

      // Se guarda la promesa: `#enviar` la espera antes de decidir si crea una
      // conversación nueva. Sin eso, escribir rápido tras abrir abriría una
      // conversación distinta de la que se está recuperando.
      this.#restaurando = this.#restaurar();
    }

    this.#chat.focusComposer();
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
    this.#leadForm?.destroy();
    this.#leadForm = undefined;
    this.#chat?.destroy();
    this.#chat = undefined;
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

  /**
   * Un turno completo.
   *
   * El servidor emite `thinking` y `speaking`. `completed` y `error` los
   * traduce el cliente a los transitorios de tess-core: sus duraciones están
   * en DEFAULT_TRANSIENT_MS y no se escriben aquí.
   */
  async #enviar(texto: string): Promise<void> {
    if (this.#enviando || !this.#chat) return;
    this.#enviando = true;

    try {
      this.#chat.append('user', texto);
      this.#emit('tess:message', { role: 'user', content: texto });

      // La recuperación puede seguir en curso: si trae conversación, es esta.
      await this.#restaurando;

      if (!this.#conversationId) {
        const creada = await this.#client.createConversation?.();
        if (creada?.conversationId) this.#recordarConversacion(creada.conversationId);
      }

      if (!this.#conversationId) {
        this.#core?.setState('error');
        this.#emit('tess:error', {
          code: 'internal',
          message: 'No se pudo abrir la conversación.',
        });
        return;
      }

      this.#chat.beginStreaming();

      for await (const evento of this.#client.sendMessage({
        conversationId: this.#conversationId,
        text: texto,
      })) {
        switch (evento.event) {
          case 'assistant.state':
            if (isRequestedState(evento.data.state)) {
              this.#core?.setState(evento.data.state);
            }
            this.#chat.setStatus(evento.data.state);
            break;

          case 'assistant.delta':
            this.#chat.pushDelta(evento.data.text);
            break;

          case 'assistant.completed': {
            const completo = this.#chat.commitStreamingAndRead();
            this.#chat.setStatus(null);
            // `success` vuelve solo a `idle`: lo gobierna tess-core.
            this.#core?.setState('success');
            this.#emit('tess:message', { role: 'assistant', content: completo });
            this.#quizaPedirLead();
            break;
          }

          case 'assistant.error':
            this.#chat.commitStreaming();
            this.#chat.setStatus('error');
            this.#core?.setState('error');
            this.#emit('tess:error', { code: evento.data.code, message: evento.data.message });
            break;

          // assistant.source llega en F3. Se ignora sin romper nada.
          default:
            break;
        }
      }
    } catch (error) {
      // Un `Origin` rechazado, un 401 o el API caído no producen un evento
      // `assistant.error`: revientan la promesa. Sin este `catch` era un
      // rejection no manejado, no se emitía `tess:error`, el estado no
      // cambiaba y la burbuja se quedaba con `aria-busy="true"` mientras la
      // región viva anunciaba «Pensando» para siempre.
      // `destroy()` pudo correr mientras el envío estaba en vuelo y dejar
      // `#chat` en `undefined`: sin `?.` el propio manejador de errores
      // lanzaría un `TypeError` y produciría otro rejection no manejado, la
      // misma clase de fallo que este `catch` viene a evitar.
      this.#chat?.commitStreaming();
      // `error` vuelve solo a `idle`: lo gobierna tess-core.
      this.#core?.setState('error');
      this.#chat?.setStatus('error');
      this.#emit<TessErrorDetail>('tess:error', {
        code: 'internal',
        message: 'No pude enviar tu mensaje. Inténtalo de nuevo.',
      });
      // El detalle técnico no va al usuario, pero sí a la consola del
      // integrador: `message` es texto para humanos y no lleva interioridades.
      console.warn('[tess] fallo al enviar el mensaje', error);
    } finally {
      this.#enviando = false;
    }
  }

  /** Solo tras la primera respuesta completa, y solo a prospectos. */
  #quizaPedirLead(): void {
    if (this.#leadForm || !this.#viewer || !this.#dialog) return;

    const clave = `tess:lead-dismissed:${this.#config.projectId ?? ''}`;
    let descartado = false;
    try {
      descartado = globalThis.localStorage?.getItem(clave) === '1';
    } catch {
      // Almacenamiento bloqueado: se muestra, que es el comportamiento útil.
    }

    if (!debeMostrarLead(this.#viewer, descartado)) return;

    this.#leadForm = createLeadForm({
      root: this.#dialog,
      locale: this.#config.locale ?? 'es',
      // El formulario espera a la promesa antes de retirarse del DOM: antes
      // desaparecía sin saber si el lead se había guardado, y un fallo de red
      // se tragaba los datos que la persona acababa de escribir.
      onSubmit: async (input) => {
        const r = await this.#client.submitLead?.(input);
        if (r) this.#emit('tess:lead', { leadId: r.leadId });
      },
      onDismiss: () => {
        try {
          globalThis.localStorage?.setItem(clave, '1');
        } catch {
          // El descarte es una preferencia local. Si no se puede guardar,
          // volverá a aparecer en la próxima visita y no pasa nada.
        }
      },
    });

    this.#leadForm.mount();
  }

  /**
   * Clave del id de conversación.
   *
   * `localStorage` y no memoria porque el gate manual pide que recargar la
   * página recupere la conversación, y el id es lo único que falta: la sesión
   * ya la persiste `tess-client` bajo `tess:session:<projectId>`.
   */
  #claveConversacion(): string {
    return `tess:conversation:${this.#config.projectId ?? ''}`;
  }

  #recordarConversacion(id: string): void {
    this.#conversationId = id;
    try {
      globalThis.localStorage?.setItem(this.#claveConversacion(), id);
    } catch {
      // Navegación privada o almacenamiento bloqueado: la conversación vive
      // en memoria y se pierde al recargar. No es motivo para romper el chat.
    }
  }

  #conversacionGuardada(): string | undefined {
    try {
      return globalThis.localStorage?.getItem(this.#claveConversacion()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Descarta el id de conversación guardado.
   *
   * Para cuando la sesión se reacuñó (`auth.uid()` cambió) y el id ya no
   * pertenece a este visitante: sin esto, `#restaurar` lo conservaba «a
   * propósito», `#enviar` nunca llamaba a `createConversation` y el widget
   * quedaba muerto para siempre con un 404 `project_not_found`.
   */
  #olvidarConversacion(): void {
    this.#conversationId = undefined;
    try {
      globalThis.localStorage?.removeItem(this.#claveConversacion());
    } catch {
      // Navegación privada o almacenamiento bloqueado: no hay nada que borrar.
    }
  }

  /**
   * Recupera viewer e historial tras un recargado de página.
   *
   * No rechaza nunca: `#enviar` la espera, y un fallo aquí —API caído, 401,
   * `Origin` rechazado— no debe dejar el widget inservible. Si `getViewer()`
   * lanzaba, `#viewer` se quedaba `undefined` y el formulario de lead no
   * aparecía jamás; ahora se avisa por `tess:error` y el chat sigue.
   */
  async #restaurar(): Promise<void> {
    try {
      this.#viewer = await this.#client.getViewer?.();
    } catch (error) {
      this.#emitError('viewer', error as Error);
    }

    this.#conversationId ??= this.#conversacionGuardada();

    if (!this.#conversationId || !this.#chat) return;

    try {
      const previos = await this.#client.listMessages?.(this.#conversationId);
      for (const m of previos ?? []) this.#chat.append(m.role, m.content);
    } catch (error) {
      // 404 (proyecto/conversación ya no existe) o 401 (sesión reacuñada,
      // el id ya no es de este visitante): el id guardado no sirve, se
      // descarta para que `#enviar` cree una conversación nueva. Cualquier
      // otro fallo —5xx, error de red— es transitorio: se conserva el id,
      // que es justo lo que el gate pide recuperar.
      if (error instanceof TessHttpError && (error.status === 404 || error.status === 401)) {
        this.#olvidarConversacion();
      }
      this.#emitError('history', error as Error);
    }
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

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(
      new CustomEvent<T>(name, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitError(code: string, error: Error): void {
    this.#emit<TessErrorDetail>('tess:error', { code, message: error.message });
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, TessAssistantElement);
}
