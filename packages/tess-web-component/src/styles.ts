/**
 * Estilos del shadow DOM. `theme` controla SOLO este chrome: el avatar Rive
 * conserva su paleta propia, porque TessStateMachine no declara inputs de
 * color.
 */
export const STYLES = `
  :host {
    --tess-bg: #ffffff;
    --tess-fg: #101418;
    --tess-border: rgba(16, 20, 24, 0.12);
    --tess-shadow: 0 8px 32px rgba(16, 20, 24, 0.18);
    --tess-size: 96px;
    --tess-gap: 16px;
    position: fixed;
    z-index: 2147483000;
    font-family: system-ui, sans-serif;
  }
  :host([theme='dark']) {
    --tess-bg: #16191d;
    --tess-fg: #f2f4f7;
    --tess-border: rgba(242, 244, 247, 0.16);
  }
  @media (prefers-color-scheme: dark) {
    :host([theme='auto']) {
      --tess-bg: #16191d;
      --tess-fg: #f2f4f7;
      --tess-border: rgba(242, 244, 247, 0.16);
    }
  }
  :host([position='bottom-right']) { inset: auto var(--tess-gap) var(--tess-gap) auto; }
  :host([position='bottom-left'])  { inset: auto auto var(--tess-gap) var(--tess-gap); }
  :host([position='top-right'])    { inset: var(--tess-gap) var(--tess-gap) auto auto; }
  :host([position='top-left'])     { inset: var(--tess-gap) auto auto var(--tess-gap); }

  button[part='launcher'] {
    width: var(--tess-size);
    height: var(--tess-size);
    padding: 0;
    border: 1px solid var(--tess-border);
    border-radius: 50%;
    background: var(--tess-bg);
    box-shadow: var(--tess-shadow);
    cursor: pointer;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  button[part='launcher']:focus-visible {
    outline: 3px solid Highlight;
    outline-offset: 2px;
  }
  canvas { width: 100%; height: 100%; display: block; }

  /* Fallback si el .riv no carga: el botón nunca queda en blanco. */
  .fallback {
    width: 60%;
    height: 60%;
    border-radius: 50%;
    background: linear-gradient(135deg, #5b8def, #9b6bdf);
  }
  .hidden { display: none; }

  dialog[part='dialog'] {
    position: absolute;
    bottom: calc(var(--tess-size) + 12px);
    right: 0;
    width: min(360px, calc(100vw - 32px));
    height: min(480px, calc(100vh - 32px));
    margin: 0;
    padding: 16px;
    border: 1px solid var(--tess-border);
    border-radius: 16px;
    background: var(--tess-bg);
    color: var(--tess-fg);
    box-shadow: var(--tess-shadow);
  }
  :host([position^='top']) dialog[part='dialog'] {
    bottom: auto;
    top: calc(var(--tess-size) + 12px);
  }
  :host([position$='left']) dialog[part='dialog'] { right: auto; left: 0; }
  dialog[part='dialog']:not([open]) { display: none; }

  [part='sources'] {
    margin-top: 0.5rem;
    font-size: 0.8125rem;
    opacity: 0.8;
  }
  [part='sources'] ul {
    margin: 0.125rem 0 0;
    padding-left: 1.1rem;
  }
  [part='source'] {
    overflow-wrap: anywhere;
  }
`;
