/**
 * Gestión de la sesión del visitante.
 *
 * Se persiste en `localStorage` y no en `sessionStorage` a conciencia: un
 * visitante que vuelve mañana conserva su `auth.uid()`, su historial y su
 * lead, que es el comportamiento que quiere un asistente de captación.
 *
 * El coste es que el refresh token vive en `localStorage`, igual que hace
 * `supabase-js` por defecto, y eso es vulnerable a XSS. Ver el README: no
 * cargar el widget junto a scripts de terceros no confiables, definir una CSP
 * en la landing, y no guardar ningún otro secreto bajo el prefijo `tess:`.
 */

/** Margen antes de la expiración. Renovar justo al filo deja carreras. */
const MARGEN_SEGUNDOS = 60;

/**
 * Error HTTP con el código de estado adjunto.
 *
 * Sin esto, `renovar()` no podía distinguir un refresh token que ya no vale
 * (401, el único caso en que reacuñar es correcto) de un fallo transitorio
 * (429, 5xx, red), y reacuñaba ante cualquier excepción. También lo usa
 * `tess-web-component` para decidir si descarta el id de conversación
 * guardado sin ensanchar la forma pública de `TessClientLike`.
 */
export class TessHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TessHttpError';
  }
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Segundos desde epoch, como lo entrega Supabase. */
  expiresAt: number;
  userId: string;
  greeting: string | null;
}

export interface TessSessionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function createMemoryStorage(): TessSessionStorage {
  const mapa = new Map<string, string>();
  return {
    get: (k) => mapa.get(k) ?? null,
    set: (k, v) => void mapa.set(k, v),
    remove: (k) => void mapa.delete(k),
  };
}

export function createBrowserStorage(): TessSessionStorage {
  return {
    get: (k) => globalThis.localStorage?.getItem(k) ?? null,
    set: (k, v) => globalThis.localStorage?.setItem(k, v),
    remove: (k) => globalThis.localStorage?.removeItem(k),
  };
}

export interface SessionManagerOptions {
  storage: TessSessionStorage;
  key: string;
  mint(): Promise<StoredSession>;
  refresh(refreshToken: string): Promise<StoredSession>;
}

export interface SessionManager {
  getToken(): Promise<string>;
  /**
   * Fuerza la renovación sin mirar la expiración.
   *
   * Es lo que necesita el reintento tras un 401 inesperado: el token puede
   * haber dejado de valer antes de la hora que declaraba.
   */
  renew(): Promise<string>;
  getSession(): StoredSession | null;
  clear(): void;
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  let enMemoria: StoredSession | null = null;

  // Todo acceso al almacenamiento va envuelto: en navegación privada o con
  // almacenamiento bloqueado lanzan, y el widget debe seguir funcionando.
  function leer(): StoredSession | null {
    if (enMemoria) return enMemoria;

    try {
      const crudo = options.storage.get(options.key);
      enMemoria = crudo ? (JSON.parse(crudo) as StoredSession) : null;
    } catch {
      enMemoria = null;
    }

    return enMemoria;
  }

  function guardar(sesion: StoredSession): void {
    enMemoria = sesion;
    try {
      options.storage.set(options.key, JSON.stringify(sesion));
    } catch {
      // Sesión efímera en memoria. No es motivo para romper el widget.
    }
  }

  function caduca(sesion: StoredSession): boolean {
    if (!sesion.expiresAt) return false;
    return sesion.expiresAt - MARGEN_SEGUNDOS <= Math.floor(Date.now() / 1000);
  }

  // Refresca si hay con qué; si no, acuña. Reacuñar cambia el `auth.uid()` y
  // con él se pierden historial y lead, así que es el último recurso, no el
  // primero.
  async function renovar(): Promise<string> {
    const actual = leer();

    if (actual) {
      try {
        const renovada = await options.refresh(actual.refreshToken);
        guardar(renovada);
        return renovada.accessToken;
      } catch (error) {
        // Solo reacuña cuando el fallo dice que el refresh token ya no vale
        // (401). Un 429, un 5xx o un error de red son transitorios: si
        // reacuñáramos ante cualquiera de ellos, un rate limit pasajero
        // detrás de un NAT compartido reacuñaría identidad y con ella se
        // perdería el historial y el lead, justo lo que esto evita.
        if (!(error instanceof TessHttpError) || error.status !== 401) throw error;
        // El refresh token pudo ser revocado o haber expirado del todo.
        // Acuñar una nueva es preferible a dejar al visitante sin chat.
      }
    }

    const nueva = await options.mint();
    guardar(nueva);
    return nueva.accessToken;
  }

  return {
    getSession: leer,

    renew: renovar,

    async getToken() {
      const actual = leer();

      if (actual && !caduca(actual)) return actual.accessToken;

      return renovar();
    },

    clear() {
      enMemoria = null;
      try {
        options.storage.remove(options.key);
      } catch {
        // Nada que hacer: ya está fuera de memoria.
      }
    },
  };
}
