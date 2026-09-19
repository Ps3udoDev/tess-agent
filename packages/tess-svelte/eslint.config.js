import library from '@teams4soft/config-eslint/library';
import svelteSupport from '@teams4soft/config-eslint/svelte-support';

/**
 * `library` trae las reglas comunes a los paquetes distribuibles (sin
 * `process` ni `import.meta`). A diferencia del resto de `packages/*`, este
 * paquete contiene un componente `.svelte`, así que se compone además con
 * `svelte-support` (el mismo bloque de `eslint-plugin-svelte` que usa
 * `@teams4soft/config-eslint/svelte` para las apps, pero sin los `globals`
 * de app que trae ese preset).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [...library, ...svelteSupport];
