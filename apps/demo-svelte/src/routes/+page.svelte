<script lang="ts">
  import { env } from '$env/dynamic/public';
  import '@teams4soft/tess-web-component';
  import {
    ASSISTANT_STATES,
    POSITIONS,
    SIZES,
    THEMES,
    type RequestedState,
    type TessPosition,
    type TessSize,
    type TessTheme,
  } from '@teams4soft/tess-types';

  const PUBLIC_TESS_API_URL = env.PUBLIC_TESS_API_URL ?? 'http://localhost:8080';
  const PUBLIC_TESS_PROJECT_ID = env.PUBLIC_TESS_PROJECT_ID ?? '';

  let requestedState = $state<RequestedState>('idle');
  let theme = $state<TessTheme>('auto');
  let size = $state<TessSize>(96);
  let position = $state<TessPosition>('bottom-right');
  let mounted = $state(true);
  let log = $state<string[]>([]);

  let container = $state<HTMLDivElement>();

  function record(event: Event): void {
    const detail = (event as CustomEvent).detail;
    const stamp = new Date().toISOString().slice(11, 23);
    log = [`${stamp}  ${event.type}  ${JSON.stringify(detail ?? {})}`, ...log].slice(0, 30);
  }

  const EVENT_TYPES = [
    'tess:state',
    'tess:error',
    'tess:open',
    'tess:close',
    'tess:message',
    'tess:lead',
  ] as const;

  $effect(() => {
    const node = container;
    if (!node) return;
    for (const type of EVENT_TYPES) node.addEventListener(type, record);
    return () => {
      for (const type of EVENT_TYPES) node.removeEventListener(type, record);
    };
  });

  /**
   * `offline` no se pide: lo deriva `tess-core` de la conectividad real
   * (`navigator.onLine` + eventos `online`/`offline` de `window`). Para
   * ejercitarlo desde el panel sin hacer trampa, se disparan esos mismos
   * eventos sobre `window` en vez de asignar el estado directamente.
   */
  function simulateOffline(): void {
    window.dispatchEvent(new Event('offline'));
  }

  function simulateOnline(): void {
    window.dispatchEvent(new Event('online'));
  }
</script>

<h1>Tess — panel de pruebas</h1>

<p>
  Demostración interactiva de Tess: avatar animado, máquina de estados y chat en tiempo real con
  streaming SSE y citas RAG contra el API local.
</p>

<section>
  <h2>Estado del Avatar</h2>
  {#each ASSISTANT_STATES as candidate (candidate)}
    <button
      type="button"
      disabled={candidate === 'offline'}
      title={candidate === 'offline' ? 'Se activa simulando la conectividad, no se pide' : ''}
      onclick={() => {
        if (candidate !== 'offline') requestedState = candidate;
      }}
    >
      {candidate}
    </button>
  {/each}
  <p>Solicitado: <code>{requestedState}</code></p>
</section>

<section>
  <h2>Conectividad</h2>
  <button type="button" onclick={simulateOffline}>Simular desconexión</button>
  <button type="button" onclick={simulateOnline}>Restablecer conexión</button>
  <p>
    Dispara los eventos <code>offline</code>/<code>online</code> de <code>window</code> que consume
    <code>tess-core</code>: el avatar cae a <code>offline</code> sin que nadie lo pida directamente.
  </p>
</section>

<section>
  <h2>Apariencia</h2>
  <label>
    Theme
    <select bind:value={theme}>
      {#each THEMES as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
  <label>
    Size
    <select bind:value={size}>
      {#each SIZES as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
  <label>
    Position
    <select bind:value={position}>
      {#each POSITIONS as value (value)}<option {value}>{value}</option>{/each}
    </select>
  </label>
</section>

<section>
  <h2>Ciclo de vida</h2>
  <button type="button" onclick={() => (mounted = !mounted)}>
    {mounted ? 'destroy' : 'remount'}
  </button>
  <p>
    Para reduced-motion, actívalo en el sistema operativo o en las herramientas de desarrollo: el
    avatar debe quedarse en una pose estática.
  </p>
</section>

<section>
  <h2>Log de eventos en tiempo real ({EVENT_TYPES.length} tipos)</h2>
  <pre>{log.join('\n') ||
      'Sin eventos todavía. Abre el asistente haciendo clic en el avatar para iniciar el chat.'}</pre>
</section>

<div bind:this={container}>
  {#if mounted}
    <teams4soft-assistant
      api-url={PUBLIC_TESS_API_URL}
      project-id={PUBLIC_TESS_PROJECT_ID}
      public-key="pk_dev_tess_local_0001"
      locale="es"
      {theme}
      {size}
      {position}
      state={requestedState}
    ></teams4soft-assistant>
  {/if}
</div>

<style>
  section {
    margin-block: 1.5rem;
  }
  button {
    margin-inline-end: 0.35rem;
  }
  label {
    margin-inline-end: 1rem;
  }
  pre {
    padding: 0.75rem;
    border-radius: 8px;
    background: #11151a;
    color: #d8e0ea;
    font-size: 0.8rem;
    max-height: 14rem;
    overflow: auto;
  }
</style>
