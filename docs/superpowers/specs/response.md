Sí, la revisión de tu agente está bastante bien y **las cuatro correcciones son correctas**. La fase está bien acotada y el diseño ya es suficientemente concreto para pasar al plan de implementación.

Sin embargo, antes de darle luz verde definitiva, le pediría **cuatro ajustes adicionales**.

# 1. Hay una contradicción en la frontera de `AssistantStreamEvent`

En la tabla aparece:

> `AssistantStreamEvent` se congela en F2 y F3 añade `assistant.source`.

Pero al inicio se dice que cada fase congela un contrato que las siguientes consumen **sin renegociarlo**.

Si F3 añade un evento nuevo, entonces el contrato sí está cambiando.

## Cómo corregirlo

Hay dos opciones válidas.

### Opción A: definir todos los eventos desde F2

Aunque F2 todavía no use `assistant.source`, se define desde el principio:

```ts
type AssistantStreamEvent =
  | { type: 'assistant.state'; state: AssistantState }
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.completed'; messageId: string }
  | { type: 'assistant.error'; code: string; message: string }
  | {
      type: 'assistant.source';
      source: {
        title: string;
        url?: string;
        documentId?: string;
      };
    };
```

F2 solo utilizaría los primeros eventos y F3 activaría `assistant.source`.

Esta es mi opción preferida.

### Opción B: versionar el contrato

Por ejemplo:

```text
F2: AssistantStreamEventV1
F3: AssistantStreamEventV2
```

Pero para este proyecto sería más complejo de lo necesario.

**Recomendación:** dile que incluya `assistant.source` desde F2 como evento tipado, aunque no se utilice todavía.

# 2. La frontera de `api-url` necesita una interfaz más clara

El documento dice:

> En Fase 1 el Web Component acepta y guarda `api-url`. En Fase 2 se lo pasa a `tess-client`. Ningún archivo de Fase 1 cambia por ello.

Aquí hay una pequeña inconsistencia. Para que Fase 2 utilice realmente `api-url`, probablemente tendrá que modificar el Web Component o el adaptador.

No es grave, pero la frontera debería definirse mejor.

## Mejor solución

En Fase 1, el Web Component debería recibir una configuración preparada para el futuro, aunque todavía no haga red:

```ts
export interface TessAssistantConfig {
  apiUrl?: string;
  projectId?: string;
  locale?: string;
}
```

Y el componente puede exponer un punto de integración:

```ts
setClient(client: TessClient): void;
```

O una interfaz estable:

```ts
export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
}
```

En Fase 1 se utiliza un cliente nulo o stub:

```ts
const client = createNoopTessClient();
```

En Fase 2 se reemplaza por:

```ts
const client = createTessClient({
  apiUrl,
});
```

Así el componente no tiene que rehacerse estructuralmente en F2.

Puedes pedirle exactamente esto:

> “Deja congelado en F1 el punto de inyección del cliente, aunque el cliente real siga siendo un stub. En F2 debe cambiar solamente la implementación del cliente, no el contrato público del Web Component.”

# 3. Los tiempos de `success` y `error` deben validarse con el `.riv`

Los valores:

```text
success: 1600 ms
error: 2400 ms
```

son razonables como valores iniciales, pero no deberían considerarse definitivos solo porque correspondan a una duración típica de feedback.

El punto importante es que existen dos duraciones diferentes:

```text
Duración lógica:
  cuánto tiempo Tess permanece en success/error

Duración visual:
  cuánto dura la animación interna de Rive
```

Esas duraciones pueden no coincidir.

## Lo que recomiendo

Mantener los valores como defaults configurables:

```ts
interface TessCoreOptions {
  transientMs?: {
    success?: number;
    error?: number;
  };
}
```

Por ejemplo:

```ts
createTessCore({
  transientMs: {
    success: 1600,
    error: 2400,
  },
});
```

Después, durante la QA visual, se verifica si la animación termina correctamente o si el estado vuelve a `idle` demasiado pronto.

Yo le pediría al agente:

> “Conserva 1600 ms y 2400 ms como defaults provisionales, pero hazlos configurables y marca la validación contra la duración real del `.riv` como criterio obligatorio de QA visual antes de cerrar F1.”

También debe comprobarse qué ocurre si llega otro estado mientras el temporizador está activo:

```text
success → thinking
error → idle
success → offline → online
```

Especialmente importante es que no quede un timer antiguo cambiando el estado después de una nueva interacción.

# 4. Aclara qué significa `theme` para el avatar

La definición de:

```html
theme="auto|light|dark"
```

está bien, pero debe aclararse qué modifica exactamente.

Por ejemplo:

```text
theme:
  modifica launcher, diálogo y estilos CSS del componente

Rive:
  conserva su apariencia propia
```

Si el archivo `.riv` no tiene inputs específicos para cambiar colores, `theme` no debería prometer cambiar el avatar internamente.

Podrías pedirle que documente:

> “`theme` controla el chrome del componente —launcher, diálogo, bordes, fondo y texto—. El avatar Rive conserva su paleta propia salvo que en el futuro se añadan inputs de color al archivo `.riv`.”

# Sobre el enum de `size`

La decisión de utilizar:

```text
48 | 96 | 128 | 256
```

es correcta para Fase 1 porque esos son los tamaños que tienen QA visual real.

Ventajas:

- Evita tamaños no probados.
- Mantiene proporciones y legibilidad.
- Permite validar cuatro casos concretos.
- Facilita detectar errores de responsive.
- Evita que el usuario pida un tamaño donde el avatar se vea mal.

Más adelante puedes soportar tamaños libres mediante CSS:

```css
teams4soft-assistant {
  --tess-size: 112px;
}
```

Pero no lo añadiría ahora como atributo público. Para esta fase dejaría:

```html
size="48|96|128|256"
```

Y documentaría que un valor inválido:

```text
cae a 96
emite tess:error
```

Eso está bien diseñado.

# Sobre los límites entre fases

El mapa general es correcto:

```text
F1 → componente visual y avatar
F2 → API, autenticación, conversaciones y SSE
F3 → documentos, embeddings y RAG
F4 → MCP, herramientas y conectores
F5 → operación, despliegue y observabilidad
```

La separación es buena porque evita intentar construir todo al mismo tiempo.

## F1 está correctamente acotada

Me parece correcto que F1 no incluya:

- Backend.
- Auth.
- Supabase.
- Chat real.
- Mensajes.
- SSE.
- Deploy productivo.
- RAG.
- MCP.

También es correcto que el diálogo esté vacío en F1. La UI conversacional debe diseñarse después de conocer la forma real del stream SSE.

## El gate de F1 está bien

Actualmente exige:

```text
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Además:

- Los siete estados visibles con el avatar real.
- Limpieza de `rive.cleanup()`.
- Desconexión de `IntersectionObserver`.
- Desconexión de `ResizeObserver`.
- Cancelación de la suscripción.
- Prueba manual de destroy/remount.
- Validación de reduced motion.

Eso ya es un gate serio y verificable.

Añadiría solamente estos criterios:

```text
- npm pack funciona para los paquetes publicables.
- La demo funciona después de instalar el paquete construido.
- El Web Component no depende accidentalmente de Svelte.
- El bundle no contiene secrets ni referencias al backend.
- El fallback CSS aparece si el archivo Rive falla.
- El launcher y el diálogo son utilizables con teclado.
```

# Un detalle adicional sobre `tess-core`

El diseño dice:

```ts
state: AssistantState;
requested: AssistantState;
```

Pero `offline` parece ser un estado derivado, no un estado solicitado por el integrador.

Sería más preciso separar los tipos:

```ts
type RequestedState = Exclude<AssistantState, 'offline'>;

interface TessSnapshot {
  state: AssistantState;
  requested: RequestedState;
  reducedMotion: boolean;
  online: boolean;
}
```

Así se evita este caso ambiguo:

```ts
setState('offline');
```

Si `offline` es solamente un override derivado de la conexión, el integrador no debería poder solicitarlo como un estado normal.

También conviene definir qué ocurre si se llama a:

```ts
core.destroy();
core.setState('thinking');
```

La respuesta debería estar especificada, por ejemplo:

```text
Después de destroy(), el core ignora operaciones y no notifica suscriptores.
```

# Mi veredicto

Le daría luz verde **con estos cambios menores antes del plan de implementación**:

1. Definir `assistant.source` desde F2, aunque se use en F3.
2. Congelar explícitamente el punto de inyección de `tess-client`.
3. Mantener `1600/2400 ms` como valores configurables y validarlos contra el `.riv`.
4. Aclarar que `theme` modifica el chrome CSS, no necesariamente el avatar Rive.
5. Cambiar `requested: AssistantState` por un tipo que excluya `offline`.
6. Añadir `npm pack`, accesibilidad básica, fallback Rive y verificación de independencia del wrapper Svelte al gate de F1.

Puedes responderle al agente algo como esto:

> La revisión está aprobada en términos generales. Antes de generar el plan de implementación, realiza estos ajustes: incluye `assistant.source` en el contrato tipado desde F2 aunque no se use hasta F3; congela en F1 el punto de inyección de `tess-client`; deja `success` y `error` como duraciones configurables con defaults de 1600/2400 ms y valida visualmente contra el `.riv`; documenta que `theme` afecta al chrome CSS y no al avatar salvo que existan inputs de color; cambia `requested` para excluir `offline`; y añade al gate de F1 la validación de `npm pack`, fallback de carga Rive, accesibilidad básica y que el Web Component no dependa de Svelte. Después de esos cambios, puedes generar el plan tarea por tarea.

Con esas correcciones, el documento queda suficientemente sólido para pasar a implementación.
