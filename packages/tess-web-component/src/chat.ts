/**
 * UI de chat del diálogo.
 *
 * Accesibilidad del streaming, que es donde esto suele salir mal: una región
 * `aria-live` que muta en cada delta hace que el lector de pantalla recite la
 * respuesta letra a letra. La regla:
 *
 *   - la burbuja en curso se pinta FUERA del log, con aria-busy="true"
 *   - al completarse, el mensaje entra en el log ya entero y se anuncia una vez
 *   - el estado de Tess se anuncia en una región viva mínima aparte
 *
 * El visitante ve el texto aparecer en vivo; quien usa lector de pantalla
 * recibe un anuncio de estado y luego la respuesta entera.
 */
import type { AssistantState } from '@teams4soft/tess-types';
import { chatLabelsFor } from './labels.js';

export interface ChatViewOptions {
  root: HTMLElement | ShadowRoot;
  locale: string;
  onSend(texto: string): void;
}

export interface ChatSource {
  title: string;
  documentId: string;
}

export interface ChatView {
  mount(): void;
  append(role: 'user' | 'assistant', content: string, fuentes?: ChatSource[]): void;
  beginStreaming(): void;
  pushDelta(texto: string): void;
  pushSource(fuente: ChatSource): void;
  commitStreaming(): void;
  commitStreamingAndRead(): string;
  setStatus(state: AssistantState | null): void;
  focusComposer(): void;
  destroy(): void;
}

/**
 * Las citas van DENTRO del `<li>` del mensaje.
 *
 * El log ya es `aria-live="polite"` con `aria-relevant="additions"`: al entrar
 * el mensaje entero, el lector anuncia texto y fuentes de una vez y en orden.
 * Si vivieran en una región viva propia se anunciarían sueltas y sin contexto.
 */
function construirFuentes(fuentes: ChatSource[], etiqueta: string): HTMLElement | null {
  if (fuentes.length === 0) return null;

  const contenedor = document.createElement('div');
  contenedor.setAttribute('part', 'sources');

  const titulo = document.createElement('span');
  titulo.setAttribute('part', 'sources-label');
  titulo.textContent = etiqueta;

  const lista = document.createElement('ul');

  for (const fuente of fuentes) {
    const item = document.createElement('li');
    item.setAttribute('part', 'source');
    // Sin enlace: el visitante no tiene permiso sobre el archivo original.
    // El documentId queda accesible para el panel de F5.
    item.dataset.documentId = fuente.documentId;
    item.textContent = fuente.title;
    lista.append(item);
  }

  contenedor.append(titulo, lista);
  return contenedor;
}

export function createChatView(options: ChatViewOptions): ChatView {
  const labels = chatLabelsFor(options.locale);

  const log = document.createElement('ol');
  log.setAttribute('part', 'messages');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');
  log.setAttribute('aria-label', labels.conversacion);

  const enCurso = document.createElement('p');
  enCurso.setAttribute('part', 'streaming');
  enCurso.setAttribute('aria-busy', 'true');

  const estado = document.createElement('p');
  estado.setAttribute('part', 'status');
  estado.setAttribute('aria-live', 'polite');

  const form = document.createElement('form');
  form.setAttribute('part', 'composer');

  const campo = document.createElement('textarea');
  campo.setAttribute('rows', '2');
  campo.setAttribute('aria-label', labels.escribe);
  campo.placeholder = labels.escribe;

  const enviar = document.createElement('button');
  enviar.type = 'submit';
  enviar.textContent = labels.enviar;

  /**
   * Fuentes del turno en curso.
   *
   * Llegan ANTES del primer delta, así que hay que guardarlas hasta que el
   * mensaje se cierre. Se vacían en `beginStreaming` para que las de un turno
   * no se arrastren al siguiente.
   */
  let fuentesEnCurso: ChatSource[] = [];

  function alEnviar(evento: Event): void {
    evento.preventDefault();
    const texto = campo.value.trim();
    if (texto === '') return;

    campo.value = '';
    options.onSend(texto);
  }

  // Enter envía, Shift+Enter hace salto de línea. Es lo que espera cualquiera
  // que haya usado un chat.
  function alTeclear(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      form.requestSubmit();
    }
  }

  return {
    mount() {
      form.append(campo, enviar);
      options.root.append(log, enCurso, estado, form);
      form.addEventListener('submit', alEnviar);
      campo.addEventListener('keydown', alTeclear);
    },

    append(role, content, fuentes = []) {
      const item = document.createElement('li');
      item.setAttribute('part', 'message');
      item.dataset.role = role;

      const texto = document.createElement('p');
      texto.textContent = content;
      item.append(texto);

      const bloque = construirFuentes(fuentes, labels.fuentes);
      if (bloque) item.append(bloque);

      log.append(item);
      log.scrollTop = log.scrollHeight;
    },

    beginStreaming() {
      enCurso.textContent = '';
      fuentesEnCurso = [];
    },

    pushDelta(texto) {
      enCurso.textContent = (enCurso.textContent ?? '') + texto;
    },

    pushSource(fuente) {
      // Deduplicar aquí también: el servidor ya emite una por documento, pero
      // el componente no debe depender de que el servidor nunca se equivoque.
      if (fuentesEnCurso.some((f) => f.documentId === fuente.documentId)) return;
      fuentesEnCurso.push(fuente);
    },

    commitStreaming() {
      const completo = enCurso.textContent ?? '';
      enCurso.textContent = '';
      if (completo !== '') this.append('assistant', completo, fuentesEnCurso);
      fuentesEnCurso = [];
    },

    commitStreamingAndRead() {
      const completo = enCurso.textContent ?? '';
      enCurso.textContent = '';
      if (completo !== '') this.append('assistant', completo, fuentesEnCurso);
      fuentesEnCurso = [];
      return completo;
    },

    setStatus(state) {
      estado.textContent = state ? (labels.estados[state] ?? '') : '';
    },

    focusComposer() {
      campo.focus();
    },

    destroy() {
      form.removeEventListener('submit', alEnviar);
      campo.removeEventListener('keydown', alTeclear);
      for (const nodo of [log, enCurso, estado, form]) nodo.remove();
    },
  };
}
