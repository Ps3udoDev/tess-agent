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
    box-sizing: border-box;
    position: absolute;
    bottom: calc(var(--tess-size) + 12px);
    right: 0;
    width: min(360px, calc(100vw - 32px));
    height: min(480px, calc(100vh - var(--tess-size) - var(--tess-gap) - 24px));
    margin: 0;
    padding: 16px;
    border: 1px solid var(--tess-border);
    border-radius: 16px;
    background: var(--tess-bg);
    color: var(--tess-fg);
    box-shadow: var(--tess-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  :host([position^='top']) dialog[part='dialog'] {
    bottom: auto;
    top: calc(var(--tess-size) + 12px);
  }
  :host([position$='left']) dialog[part='dialog'] { right: auto; left: 0; }
  dialog[part='dialog']:not([open]) { display: none; }

  ol[part='messages'] {
    box-sizing: border-box;
    flex: 1;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li[part='message'] {
    box-sizing: border-box;
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 12px;
    font-size: 0.875rem;
    line-height: 1.45;
    word-break: break-word;
  }
  li[part='message'] p {
    margin: 0;
  }
  li[part='message'][data-role='user'] {
    align-self: flex-end;
    background: #2563eb;
    color: #ffffff;
    border-bottom-right-radius: 2px;
  }
  li[part='message'][data-role='assistant'] {
    align-self: flex-start;
    background: rgba(125, 125, 125, 0.1);
    color: var(--tess-fg);
    border: 1px solid var(--tess-border);
    border-bottom-left-radius: 2px;
  }

  p[part='streaming'] {
    box-sizing: border-box;
    margin: 4px 0 0 0;
    padding: 8px 12px;
    background: rgba(125, 125, 125, 0.08);
    border: 1px dashed var(--tess-border);
    border-radius: 12px;
    border-bottom-left-radius: 2px;
    max-width: 85%;
    align-self: flex-start;
    font-size: 0.875rem;
    line-height: 1.45;
    word-break: break-word;
  }
  p[part='streaming']:empty {
    display: none;
  }

  p[part='status'] {
    font-size: 0.75rem;
    opacity: 0.65;
    margin: 4px 0;
    font-style: italic;
  }
  p[part='status']:empty {
    display: none;
  }

  form[part='composer'] {
    box-sizing: border-box;
    display: flex;
    gap: 8px;
    margin-top: 10px;
    align-items: flex-end;
    border-top: 1px solid var(--tess-border);
    padding-top: 10px;
  }
  form[part='composer'] textarea {
    box-sizing: border-box;
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--tess-border);
    border-radius: 8px;
    background: var(--tess-bg);
    color: var(--tess-fg);
    resize: none;
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.35;
    height: 48px;
  }
  form[part='composer'] textarea:focus {
    outline: 2px solid #2563eb;
    outline-offset: -1px;
  }
  form[part='composer'] button {
    box-sizing: border-box;
    padding: 8px 14px;
    height: 48px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  form[part='composer'] button:hover {
    opacity: 0.9;
  }

  section[part='lead'] {
    box-sizing: border-box;
    margin-bottom: 8px;
    padding: 10px 12px;
    background: rgba(37, 99, 235, 0.08);
    border: 1px solid rgba(37, 99, 235, 0.2);
    border-radius: 10px;
    font-size: 0.8125rem;
  }
  section[part='lead'] h3 {
    margin: 0 0 8px;
    font-size: 0.875rem;
  }
  section[part='lead'] form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  section[part='lead'] input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--tess-border);
    border-radius: 6px;
    background: var(--tess-bg);
    color: var(--tess-fg);
    font-size: 0.8125rem;
  }
  section[part='lead'] button[type='submit'] {
    padding: 6px 12px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }
  section[part='lead'] button[type='button'] {
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--tess-fg);
    opacity: 0.7;
    cursor: pointer;
    font-size: 0.75rem;
  }

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
