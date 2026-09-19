import { defineConfig } from 'tsup';

export default defineConfig({
  // `instrument` es un entry propio para poder cargarlo con `node --import`
  // antes que cualquier otro módulo de la aplicación.
  entry: ['src/main.ts', 'src/instrument.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  // Las dependencias viajan en node_modules dentro de la imagen, no en el bundle.
  skipNodeModulesBundle: true,
});
