import { defineConfig } from 'tsup';

export default defineConfig([
  // Paquete npm: ESM, con las dependencias del workspace resueltas por el consumidor.
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2023',
  },
  // Bundle autocontenido para CDN: <script src="...tess.global.js"></script>
  // tsup añade el sufijo `.global` al nombre del entry en formato iife, así que
  // el entry se llama `tess` y el archivo resultante es `tess.global.js`.
  {
    entry: { tess: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Teams4SoftTess',
    noExternal: [/.*/],
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    target: 'es2023',
  },
]);
