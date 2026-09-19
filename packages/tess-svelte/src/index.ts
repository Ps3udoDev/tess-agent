/**
 * @teams4soft/tess-svelte
 *
 * Wrapper Svelte sobre `<teams4soft-assistant>`. Es una envoltura del mismo
 * núcleo, no una implementación paralela.
 *
 * `TAG_NAME` se reexporta desde `tess-types`, NO desde `tess-web-component`:
 * ese paquete registra el custom element (`class ... extends HTMLElement`)
 * en cuanto se importa, lo que revienta bajo SSR (no existe `HTMLElement`
 * fuera del navegador). `Tess.svelte` ya difiere ese import a `onMount`;
 * reexportar `TAG_NAME` desde el mismo módulo lo habría anulado.
 */
export { default as Tess } from './Tess.svelte';
export { TAG_NAME } from '@teams4soft/tess-types';
