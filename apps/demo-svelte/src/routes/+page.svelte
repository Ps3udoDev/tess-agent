<script lang="ts">
  import { ASSISTANT_STATES } from '@teams4soft/tess-types';

  // TODO(fase-1): montar <teams4soft-assistant> y enlazar estos estados a los
  // inputs de TessStateMachine vía @teams4soft/tess-rive.
</script>

<h1>Tess — demo</h1>
<p>Scaffold listo. El Web Component todavía no está implementado.</p>

<h2>Contrato de estados</h2>
<ul>
  {#each ASSISTANT_STATES as state (state)}
    <li><code>{state}</code></li>
  {/each}
</ul>
