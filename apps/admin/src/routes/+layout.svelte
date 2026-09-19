<script lang="ts">
  let { children } = $props();
</script>

<main>
  {@render children()}
</main>

<style>
  :global(:root) {
    --tess-deep-blue: #123b66;
    --tess-cyan: #34c6d8;
    --tess-coral: #f47c6c;
    --tess-surface: #f7fafc;
    --tess-text: #12212f;
  }

  :global(body) {
    margin: 0;
    background: var(--tess-surface);
    color: var(--tess-text);
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }

  main {
    max-width: 64rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }
</style>
