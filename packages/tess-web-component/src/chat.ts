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

export interface ChatView {
  mount(): void;
  append(role: 'user' | 'assistant', content: string): void;
  beginStreaming(): void;
  pushDelta(texto: string): void;
  commitStreaming(): void;
  commitStreamingAndRead(): string;
  setStatus(state: AssistantState | null): void;
  focusComposer(): void;
  destroy(): void;
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

    append(role, content) {
      const item = document.createElement('li');
      item.setAttribute('part', role === 'user' ? 'message-user' : 'message-assistant');
      item.textContent = content;
      log.append(item);
      log.scrollTop = log.scrollHeight;
    },

    beginStreaming() {
      enCurso.textContent = '';
    },

    pushDelta(texto) {
      enCurso.textContent = (enCurso.textContent ?? '') + texto;
    },

    commitStreaming() {
      const completo = enCurso.textContent ?? '';
      enCurso.textContent = '';
      if (completo !== '') this.append('assistant', completo);
    },

    commitStreamingAndRead() {
      const completo = enCurso.textContent ?? '';
      enCurso.textContent = '';
      if (completo !== '') this.append('assistant', completo);
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
