# Decisión de Fase 3 — OpenRouter, RAG y embeddings de Tess

Fecha: 2026-09-19

## Veredicto ejecutivo

Sí, **OpenRouter puede utilizarse como punto central de acceso para Tess**. Es compatible con el objetivo de disponer de una sola API para diferentes modelos, routing, fallbacks, streaming y embeddings.

La decisión recomendada es:

```text
OpenRouter:
  chat, streaming y embeddings

Tess:
  mantiene ModelProvider y EmbeddingProvider como interfaces

Supabase:
  Postgres, pgvector, Storage, Auth y RLS

Chat:
  @openrouter/ai-sdk-provider + Vercel AI SDK

Embeddings:
  @openrouter/sdk o REST /api/v1/embeddings detrás de EmbeddingProvider

CI:
  fake providers, sin red

Producción:
  OpenRouter con modelo de chat y modelo de embeddings fijados explícitamente
```

OpenRouter centraliza el acceso técnico y la facturación de los modelos, pero no significa que exista un único proveedor de cómputo. OpenRouter puede enrutar una solicitud a distintos proveedores subyacentes. Por ello debe configurarse conscientemente qué proveedores pueden recibir datos de clientes.

## Qué cambia respecto a F2

F2 dejó esta decisión:

```text
MODEL_PROVIDER=fake | gateway
AI Gateway para el provider real
AI_GATEWAY_API_KEY
```

Para Tess se recomienda sustituirlo por:

```text
MODEL_PROVIDER=fake | openrouter
EMBEDDING_PROVIDER=fake | openrouter
OPENROUTER_API_KEY
OPENROUTER_CHAT_MODEL
OPENROUTER_EMBEDDING_MODEL
```

No se debe renombrar el código interno a `OpenRouter` en todas partes. El cambio debe afectar al adaptador del proveedor y a la configuración. La lógica del agente, RAG, SSE, prompts, auditoría y permisos debe seguir dependiendo de interfaces internas de Tess.

Esto conserva la posibilidad de añadir en el futuro:

```text
OpenAI directo
Anthropic directo
Google directo
Proveedor local
Proveedor privado de un cliente
```

sin reescribir el API ni el worker.

## Por qué OpenRouter es adecuado

OpenRouter ofrece:

- Un endpoint unificado para modelos de diferentes proveedores.
- Streaming mediante SSE.
- SDK TypeScript.
- Compatibilidad con el patrón de `streamText` del AI SDK mediante `@openrouter/ai-sdk-provider`.
- Fallbacks entre modelos.
- Selección y orden de proveedores.
- Controles sobre recopilación de datos y Zero Data Retention cuando los endpoints compatibles lo permiten.
- Endpoint unificado de embeddings.
- Listado de modelos y modelos de embeddings.

Para Tess esto permite separar el producto de la elección del modelo sin exponer ninguna clave al navegador.

## Limitación importante: centralización no significa aislamiento total

Con OpenRouter, el flujo real es:

```text
Tess API
   ↓ OPENROUTER_API_KEY
OpenRouter
   ↓ routing
Proveedor subyacente del modelo
   ↓
Respuesta a Tess API
```

Por tanto, antes de producción debe definirse una política de datos:

```text
- Qué proveedores pueden recibir prompts
- Qué proveedores pueden recibir documentos o fragmentos RAG
- Si se permite data collection
- Si se exige ZDR
- Qué regiones o jurisdicciones son aceptables
- Qué modelos están aprobados
- Qué información debe anonimizarse antes de salir de Tess
```

Para documentos privados, la configuración inicial debe ser restrictiva:

```json
{
  "provider": {
    "data_collection": "deny",
    "allow_fallbacks": false,
    "require_parameters": true
  }
}
```

`zdr: true` puede utilizarse únicamente si el conjunto de proveedores y modelos aprobado ofrece endpoints compatibles con Zero Data Retention. Si no existe disponibilidad suficiente, el sistema debe fallar de forma explícita o utilizar una lista aprobada; no debe activar automáticamente proveedores desconocidos para mantener disponibilidad.

## Arquitectura propuesta

```text
services/api
├── agent/
│   ├── model-provider.ts          interfaz estable
│   ├── model-provider.fake.ts     CI y tests
│   └── model-provider.openrouter.ts
│
├── rag/
│   ├── retrieval.ts               usa EmbeddingProvider + RPC Supabase
│   ├── prompt-context.ts
│   └── citations.ts
│
└── http/messages.route.ts         SSE y orquestación

services/ingest-worker
└── src/embed/
    ├── provider.ts                interfaz estable
    ├── fake.ts                    CI
    └── openrouter.ts              embeddings vía OpenRouter
```

### Flujo de consulta

```text
1. API autentica JWT
2. Inserta mensaje del usuario con el JWT del usuario
3. Abre SSE y emite thinking
4. EmbeddingProvider genera embedding de la pregunta
5. API llama match_document_sections() con el JWT del usuario
6. Supabase autoriza mediante visitor_sessions o membresía
7. API compone prompt con las secciones recuperadas
8. ModelProvider inicia streaming en OpenRouter
9. API emite assistant.source antes del primer delta
10. API emite deltas
11. API persiste respuesta y emite completed
```

### Flujo de ingestión

```text
1. Miembro sube documento al API
2. API guarda archivo privado en Supabase Storage
3. API crea documents.status = pending
4. Worker reclama el documento mediante RPC
5. Worker extrae PDF, Markdown o TXT
6. Worker divide en chunks
7. Worker llama EmbeddingProvider de OpenRouter
8. Worker guarda embeddings con model y dimensions
9. Worker marca ready o failed
```

La ingesta continúa fuera de las peticiones interactivas.

## Modelo de chat

### Recomendación

Usar el adaptador oficial de OpenRouter para Vercel AI SDK:

```bash
pnpm add @openrouter/ai-sdk-provider ai
```

Ejemplo conceptual:

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = streamText({
  model: openrouter(process.env.OPENROUTER_CHAT_MODEL!),
  messages,
  abortSignal: signal,
});
```

El adaptador vive únicamente en `model-provider.openrouter.ts`. El resto del API consume `ModelProvider`.

### Modelo fijado

No usar un alias de modelo que pueda cambiar de comportamiento sin un despliegue controlado. En producción, fijar explícitamente:

```env
OPENROUTER_CHAT_MODEL=provider/model-version
```

El agente debe registrar en logs y en metadatos de auditoría el modelo realmente utilizado, pero nunca el prompt completo.

### Fallbacks de chat

Los fallbacks de chat son útiles para disponibilidad, pero pueden cambiar:

- Estilo de respuesta.
- Adherencia al prompt.
- Idioma.
- Manejo de contexto largo.
- Compatibilidad con parámetros.
- Calidad de citas.

Por eso la política inicial debe ser:

```text
Modelo primario fijado
Fallback explícito y aprobado
Máximo de fallbacks pequeño
Mismos requisitos de contexto y salida
Registro del modelo final utilizado
```

No permitir que OpenRouter elija libremente cualquier modelo cuando Tess está respondiendo con documentación corporativa.

## Embeddings y compatibilidad con Supabase

El esquema actual utiliza:

```text
vector(1536)
```

El valor por defecto `openai/text-embedding-3-small` produce normalmente una salida de 1536 dimensiones cuando se utiliza su configuración estándar, pero el sistema debe verificar la dimensión real de la respuesta. No se debe confiar solo en el nombre del modelo.

### Configuración recomendada

```env
EMBEDDING_PROVIDER=fake
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

Producción:

```env
EMBEDDING_PROVIDER=openrouter
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

El worker y el API deben usar exactamente el mismo modelo y dimensión. La búsqueda debe continuar pasando `p_model` a `match_document_sections()`.

### No mezclar modelos sin plan

Los embeddings de modelos diferentes no deben mezclarse en una misma búsqueda. La columna `model` y el filtro `p_model` son correctos.

Para cambiar de modelo:

```text
1. Mantener A activo
2. Reindexar con B en filas paralelas
3. Validar calidad y dimensión de B
4. Cambiar API y worker a B en el mismo despliegue
5. Mantener A para rollback
6. Eliminar A después de comprobar B
```

Si el nuevo modelo no tiene 1536 dimensiones, no basta con cambiar una variable. Es necesario migrar `vector(1536)`, índices, validaciones y la función RPC, normalmente en una fase de migración específica.

### EmbeddingProvider

La interfaz debe preservar el control de dimensiones:

```ts
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(input: string, signal?: AbortSignal): Promise<number[]>;
  embedMany(input: string[], signal?: AbortSignal): Promise<number[][]>;
}
```

El adaptador OpenRouter debe:

- Validar que cada vector tenga `EMBEDDING_DIMENSIONS`.
- Rechazar respuestas incompletas.
- Respetar `AbortSignal`.
- Hacer batching limitado en ingestión.
- Aplicar timeout y reintentos controlados.
- No registrar el texto completo de los documentos.
- Registrar modelo, cantidad de textos, duración, dimensión y código de error.

## Decisiones D1-D7

### D1 — Dónde entra la recuperación

**Decisión: opción (a), dentro del stream con degradación.**

Abrir SSE y emitir `thinking` antes de recuperar. Si falla el embedding o el RPC de recuperación:

```text
- registrar error técnico
- registrar audit_event rag.retrieval.failed
- continuar sin contexto
- no emitir assistant.source
- permitir que el modelo responda con las reglas de falta de evidencia
```

Esto conserva la respuesta visual inmediata y evita que un fallo temporal de OpenRouter convierta todo el chat en error. El `AbortSignal` debe cancelar tanto el embedding como la llamada posterior al modelo.

### D2 — Estrategia de chunking

**Decisión: opción (a), chunking estructural de 700 tokens con 80 de solape.**

Primero respetar encabezados de Markdown y límites de párrafo. Solo cortar por tokens cuando un bloque exceda el tamaño máximo.

Cada sección debe conservar:

```text
ordinal
heading_path
content
metadata
```

Los 700/80 son defaults iniciales que deben medirse con documentos reales. No son una garantía universal.

### D3 — Fallo y reintento del worker

**Decisión: opción (a), un intento automático y estado `failed`.**

No implementar todavía reintentos automáticos indefinidos. El worker debe:

- Capturar error legible.
- Marcar `failed`.
- Guardar `failure_reason` sanitizado.
- Liberar la reclamación.
- No dejar el documento en `processing` para siempre.

Añadir `retry_count` o un mecanismo de reencolado manual como mejora posterior. Un error de OpenRouter por rate limit puede tener reintento, pero debe ser un retry acotado por request, no un bucle del worker.

### D4 — Cuándo emitir citas

**Decisión: opción (a), una cita por documento antes del primer delta.**

- Emitir una fuente por cada documento distinto.
- No emitir una fuente por cada sección.
- Persistir el detalle de secciones en `messages.sources`.
- Emitir el resumen antes de `assistant.delta`.

Esto es correcto porque el usuario necesita saber el origen mientras recibe la respuesta, mientras que el panel futuro necesita el detalle completo.

### D5 — Quién sube documentos

**Decisión: opción (a), endpoint autenticado en el API.**

Implementar:

```text
POST /v1/projects/:projectId/documents
GET  /v1/projects/:projectId/documents
```

Solo miembros autorizados pueden subir o consultar el estado. El panel admin queda fuera de F3, pero el contrato HTTP ya existe para que el panel futuro lo consuma.

El endpoint debe:

- Validar MIME real y extensión.
- Limitar tamaño.
- Generar nombre/ruta segura.
- Evitar path traversal.
- No aceptar `organization_id` del cliente.
- Usar la organización derivada del proyecto y la sesión.
- Guardar el archivo en bucket privado.
- Crear el documento como `pending`.

### Nota sobre PDF

F3 soporta PDF textual, Markdown y TXT. Un PDF escaneado termina en `failed` por estar el OCR fuera de alcance.

### D6 — Cero secciones recuperadas

**Decisión: opción (a), responder sin bloque RAG.**

No añadir un mensaje fijo ni decir automáticamente «no hay documentación». Un saludo o una pregunta general puede no necesitar contexto.

El prompt debe seguir diciendo que no se inventen datos concretos. Si no hay evidencia, Tess debe ser transparente.

### D7 — Rate limit

**Decisión: opción (a), límite por conversación al enviar mensaje.**

Aplicar un límite inicial de 30 mensajes por conversación en 5 minutos. Esto protege simultáneamente:

```text
embedding de la pregunta
llamada de chat
```

Debe mantenerse la abstracción `RateLimiter` de F2. Para producción en Cloud Run, sustituir `MemoryRateLimiter` por almacenamiento distribuido antes de declarar el sistema listo.

Además, OpenRouter debe tener límites de presupuesto y alertas configurados. El límite de conversación no sustituye controles de gasto por proyecto.

## Variables de entorno finales

```env
# Proveedores IA
MODEL_PROVIDER=fake
EMBEDDING_PROVIDER=fake
OPENROUTER_API_KEY=
OPENROUTER_CHAT_MODEL=
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

# Dimensiones y RAG
EMBEDDING_DIMENSIONS=1536
RAG_MATCH_COUNT=8
RAG_SIMILARITY_THRESHOLD=0.5

# OpenRouter attribution opcional
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Tess

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DOCUMENTS_BUCKET=tess-documents
DOCUMENT_MAX_BYTES=26214400

# Worker
INGEST_POLL_INTERVAL_MS=5000
```

### Validaciones al arrancar

```text
MODEL_PROVIDER=openrouter → OPENROUTER_API_KEY y OPENROUTER_CHAT_MODEL obligatorios
EMBEDDING_PROVIDER=openrouter → OPENROUTER_API_KEY y OPENROUTER_EMBEDDING_MODEL obligatorios
EMBEDDING_DIMENSIONS = 1536 mientras el esquema siga vector(1536)
OPENROUTER_CHAT_MODEL != OPENROUTER_EMBEDDING_MODEL
```

El arranque puede hacer una comprobación ligera de configuración, pero no debe consumir una llamada de modelo en cada deploy. La dimensión real debe verificarse en el primer smoke test y en el worker antes de insertar vectores.

## Seguridad y privacidad

OpenRouter debe llamarse exclusivamente desde Cloud Run o desde el backend. Nunca desde el Web Component.

No enviar a OpenRouter:

- `SUPABASE_SERVICE_ROLE_KEY`.
- JWT completos como parte del prompt.
- Refresh tokens.
- Datos de otros tenants.
- Documentos completos si solo se necesitan fragmentos.
- Datos personales que no sean necesarios para resolver la consulta.

El contexto RAG debe limitarse a las secciones recuperadas por la RPC autorizada. Antes de llamar a OpenRouter, el API debe comprobar que el proyecto de cada sección coincide con el proyecto de la conversación.

En Sentry y logs:

```text
sí: modelo, proveedor, duración, cantidad de tokens si está disponible, trace_id, project_id anonimizado
no: prompt completo, contenido de documentos, correo completo, tokens, API keys
```

## Observabilidad y coste

Registrar por solicitud:

```text
provider
requested_model
actual_model
request_id
trace_id
latency_ms
input/output token counts si están disponibles
embedding_count
retrieved_sections
retrieved_documents
fallback_used
error_code
```

Los valores de contenido deben omitirse o anonimizarse. El `actual_model` es importante porque OpenRouter puede usar un fallback.

Configurar alertas para:

- Aumento de `model_unavailable`.
- Fallos de embeddings.
- Fallbacks frecuentes.
- Latencia p95.
- Coste por proyecto.
- Aumento de mensajes por conversación.
- Documentos en `failed`.

## Gate de Fase 3 actualizado

El gate debe exigir:

```text
1. gate:f2 en verde.
2. Worker procesa PDF textual, Markdown y TXT.
3. Documento pasa de pending a ready.
4. Embeddings tienen exactamente 1536 dimensiones.
5. API y worker usan el mismo embedding model.
6. RLS impide recuperar documentos de otro proyecto.
7. Visitante del proyecto A recupera solo A.
8. Visitante no puede leer document_sections por PostgREST.
9. assistant.source llega antes del primer delta.
10. messages.sources conserva detalle de las secciones.
11. Si RAG falla, el chat degrada sin citas y deja auditoría.
12. Una fuente por documento, no una por sección.
13. El endpoint de subida solo acepta miembros.
14. Un MIME no soportado marca failed sin tumbar el worker.
15. Rate limit de 30 mensajes por conversación en 5 minutos.
16. CI sigue utilizando fake providers y no llama a OpenRouter.
17. Smoke test manual con OpenRouter produce streaming real.
18. El smoke test verifica la dimensión del embedding y registra el modelo real.
```

## Decisión final

OpenRouter es una buena elección para Tess y mejora la centralización, pero la implementación correcta es:

```text
OpenRouter como adaptador de infraestructura
Interfaces internas estables
Modelo de chat fijado
Modelo de embeddings fijado a 1536 dimensiones
Fallbacks explícitos
Política de proveedores aprobados
Provider fake para CI
RAG autorizado por Supabase y RLS
```

No se recomienda eliminar `ModelProvider` ni `EmbeddingProvider` para llamar a OpenRouter directamente desde las rutas. Eso produciría acoplamiento, dificultaría las pruebas y haría más costoso cambiar de proveedor.

La Fase 3 puede aprobarse después de incorporar este cambio de configuración y de cerrar las siete decisiones con las opciones indicadas arriba.

## Referencias oficiales

[1]: https://openrouter.ai/docs/quickstart 'OpenRouter Quickstart'
[2]: https://openrouter.ai/docs/api_reference/embeddings 'OpenRouter Embeddings API'
[3]: https://openrouter.ai/docs/guides/routing/model-fallbacks 'OpenRouter Model Fallbacks'
[4]: https://openrouter.ai/docs/guides/routing/provider-selection 'OpenRouter Provider Routing'
[5]: https://openrouter.ai/docs/guides/community/vercel-ai-sdk 'OpenRouter with Vercel AI SDK'
