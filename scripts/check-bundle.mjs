import { readFileSync } from 'node:fs';

// El web component es vanilla. Si Svelte aparece en su bundle IIFE, es una
// fuga del wrapper y rompe a cualquier integrador que no use Svelte.
const bundle = readFileSync('packages/tess-web-component/dist/tess.global.js', 'utf8');

const forbidden = [
  ['Svelte', /svelte/i],
  ['URL de Supabase', /supabase\.co/i],
  ['localhost', /localhost:\d+/],
  ['clave JWT', /eyJhbGciOi/],
  ['zod', /ZodType|zodError|\$ZodType/],
  ['clave pública en el bundle', /pk_live_/],
  ['AI Gateway key', /vck_/],
];

const found = forbidden.filter(([, pattern]) => pattern.test(bundle));

if (found.length > 0) {
  console.error('FALLO: el bundle contiene:', found.map(([name]) => name).join(', '));
  process.exit(1);
}

console.log(`OK: tess.global.js limpio (${(bundle.length / 1024).toFixed(1)} kB)`);
