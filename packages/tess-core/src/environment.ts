import type { ConnectivityLike, MediaQueryListLike } from './core.js';

/** Adaptador de conectividad. En SSR asume online y no se suscribe a nada. */
export function browserConnectivity(): ConnectivityLike {
  const hasWindow = typeof globalThis.window !== 'undefined';
  return {
    isOnline: () => (hasWindow && typeof navigator !== 'undefined' ? navigator.onLine : true),
    subscribe(fn) {
      if (!hasWindow) return () => {};
      const goOnline = () => fn(true);
      const goOffline = () => fn(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    },
  };
}

/** Adaptador de media queries. Devuelve null en SSR. */
export function browserMedia(query: string): MediaQueryListLike | null {
  if (typeof globalThis.matchMedia !== 'function') return null;
  return globalThis.matchMedia(query);
}
