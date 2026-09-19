<script lang="ts">
  import { onMount } from 'svelte';
  import type { TessPosition, TessSize, TessTheme } from '@teams4soft/tess-types';

  interface Props {
    state?: string;
    theme?: TessTheme;
    size?: TessSize;
    position?: TessPosition;
    apiUrl?: string;
    locale?: string;
  }

  let {
    state = 'idle',
    theme = 'auto',
    size = 96,
    position = 'bottom-right',
    apiUrl,
    locale,
  }: Props = $props();

  // El registro del custom element es un efecto secundario del import, y solo
  // puede ocurrir en el navegador: en SSR no existe customElements.
  onMount(() => {
    void import('@teams4soft/tess-web-component');
  });
</script>

<teams4soft-assistant {state} {theme} {position} size={String(size)} api-url={apiUrl} {locale}
></teams4soft-assistant>
