/**
 * Captura de leads.
 *
 * Para PROSPECTOS, no para cualquiera con un JWT: un miembro del proyecto o un
 * administrador interno no debe ver esto, salvo que el proyecto lo pida
 * expresamente con `collect_leads_from_members`.
 *
 * Lo dispara el widget, no el modelo. Que Tess decida conversacionalmente
 * cuándo pedir los datos es tool-calling, y eso es F4.
 */
import type { LeadInput, TessViewer } from '@teams4soft/tess-types';

export function debeMostrarLead(viewer: TessViewer, descartado: boolean): boolean {
  const esProspecto = !viewer.isProjectMember || viewer.collectLeadsFromMembers;
  return esProspecto && viewer.lead === null && !descartado;
}

export interface LeadFormOptions {
  root: HTMLElement | ShadowRoot;
  locale: string;
  /**
   * Puede devolver una promesa: el formulario NO se retira del DOM hasta que
   * resuelva. Si falla, se lo dice a la persona y conserva lo que escribió.
   */
  onSubmit(input: LeadInput): void | Promise<void>;
  onDismiss(): void;
}

export interface LeadForm {
  mount(): void;
  destroy(): void;
}

const TEXTOS = {
  es: {
    titulo: '¿Quieres que te contactemos?',
    nombre: 'Nombre',
    correo: 'Correo',
    enviar: 'Enviar',
    ahoraNo: 'Ahora no',
    privacidad:
      'Usaremos tus datos solo para responderte. Consulta nuestra política de privacidad.',
    fallo: 'No pudimos guardar tus datos. Inténtalo de nuevo.',
  },
  en: {
    titulo: 'Want us to get in touch?',
    nombre: 'Name',
    correo: 'Email',
    enviar: 'Send',
    ahoraNo: 'Not now',
    privacidad: 'We will use your details only to reply. See our privacy policy.',
    fallo: 'We could not save your details. Please try again.',
  },
};

export function createLeadForm(options: LeadFormOptions): LeadForm {
  const t = options.locale.startsWith('en') ? TEXTOS.en : TEXTOS.es;

  const caja = document.createElement('section');
  caja.setAttribute('part', 'lead');

  const titulo = document.createElement('h3');
  titulo.textContent = t.titulo;

  const form = document.createElement('form');

  const nombre = document.createElement('input');
  nombre.type = 'text';
  nombre.setAttribute('aria-label', t.nombre);
  nombre.placeholder = t.nombre;

  const correo = document.createElement('input');
  correo.type = 'email';
  correo.setAttribute('aria-label', t.correo);
  correo.placeholder = t.correo;

  const enviar = document.createElement('button');
  enviar.type = 'submit';
  enviar.textContent = t.enviar;

  const descartar = document.createElement('button');
  descartar.type = 'button';
  descartar.textContent = t.ahoraNo;

  const privacidad = document.createElement('p');
  privacidad.setAttribute('part', 'lead-privacy');
  privacidad.textContent = t.privacidad;

  // `role="alert"` para que el fallo se anuncie: quien usa lector de pantalla
  // no vería de otro modo que el envío no salió.
  const fallo = document.createElement('p');
  fallo.setAttribute('part', 'lead-error');
  fallo.setAttribute('role', 'alert');
  fallo.hidden = true;

  async function alEnviar(evento: Event): Promise<void> {
    evento.preventDefault();

    const input: LeadInput = {};
    if (correo.value.trim() !== '') input.email = correo.value.trim();
    if (nombre.value.trim() !== '') input.fullName = nombre.value.trim();

    // Al menos uno. Un lead sin ninguno de los dos no es un lead.
    if (input.email === undefined && input.fullName === undefined) return;

    // Atribución de la landing anfitriona.
    const attribution: Record<string, string> = {};
    if (typeof location !== 'undefined') attribution.landing_url = location.href;
    if (typeof document !== 'undefined' && document.referrer)
      attribution.referrer = document.referrer;

    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    for (const clave of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const valor = params.get(clave);
      if (valor) attribution[clave] = valor;
    }

    if (Object.keys(attribution).length > 0) input.attribution = attribution;

    // El formulario se retiraba del DOM ANTES de saber si el lead se había
    // guardado. Ahora espera, y si falla conserva lo escrito y lo dice.
    fallo.hidden = true;
    enviar.disabled = true;

    try {
      await options.onSubmit(input);
      caja.remove();
    } catch {
      fallo.textContent = t.fallo;
      fallo.hidden = false;
      enviar.disabled = false;
    }
  }

  // El listener necesita un nombre estable para poder retirarse en destroy().
  function alEnviarSync(evento: Event): void {
    void alEnviar(evento);
  }

  function alDescartar(): void {
    options.onDismiss();
    caja.remove();
  }

  return {
    mount() {
      form.append(nombre, correo, enviar, descartar);
      caja.append(titulo, form, fallo, privacidad);
      options.root.append(caja);
      form.addEventListener('submit', alEnviarSync);
      descartar.addEventListener('click', alDescartar);
    },

    destroy() {
      form.removeEventListener('submit', alEnviarSync);
      descartar.removeEventListener('click', alDescartar);
      caja.remove();
    },
  };
}
