# Fase 3 — RAG

Fecha: 2026-09-19
Estado: **aprobado**, pendiente de plan de implementación
Roadmap: `docs/roadmap-tess.md`
Fase anterior: `docs/superpowers/specs/2026-09-19-fase-2-backend-chat-design.md`
Decisiones de proveedor: `docs/superpowers/specs/decisiones-fase-3-openrouter-rag-tess.md`

## Contexto

F2 cerró con Tess contestando. El gate pasa, los 188 tests están en verde y
los 11 de RLS corren de verdad contra Supabase local. Un visitante abre la
landing, se le acuña una sesión anónima validando origen, clave y rate limit,
escribe, y recibe texto en streaming por SSE.

Lo que contesta, sin embargo, sale solo del modelo y del `system_prompt` del
proyecto. Tess no ha leído nada del cliente. El bloque de reglas no anulables
de `agent/prompt.ts` le prohíbe inventar servicios, precios o integraciones,
así que hoy la respuesta honesta a casi cualquier pregunta concreta es «no lo
sé». F3 es lo que convierte ese «no lo sé» en una respuesta con fuente.

El terreno está preparado desde antes de F1:

- `documents`, `document_sections` y `document_embeddings` existen en `0003`,
  con `vector(1536)`, índice HNSW coseno y `unique (section_id, model)`.
- `match_document_sections()` existe en `0007`.
- `messages.sources` existe en `0004` con el comentario
  `[{ documentId, sectionId, title }]`.
- `assistant.source` está tipado en `packages/tess-types/src/events.ts` desde
  F1 y nadie lo emite.
- `agent/prompt.ts` documenta seis posiciones en el orden del prompt y reserva
  la sexta: `6. contexto RAG ← F3`.
- `documents_status_idx` es un índice parcial `where status <> 'ready'`.

Lo que no existe: `services/ingest-worker` tiene el `main.ts` del scaffold y
nada más, y los cuatro archivos de `services/api/src/rag/` son `export {}` con
un `TODO(fase-3)`.

### Dos cosas que la revisión de cierre de F2 encontró

**La primera, el roadmap ya la anota.** `conversations_insert_visitor` de
`0009` exige `project_accepts_visitors(project_id)` y `user_id = auth.uid()`,
y nada más. Nada ata el JWT anónimo al proyecto que lo acuñó: ni el minteo
pone un claim, ni `resolveProject` lo comprueba, ni `plugins/auth.ts` lo mira.
Cualquier sesión de visitante sirve en cualquier proyecto con
`visitor_access`. Validar el `Origin` guarda el minteo, no el uso posterior.

**La segunda no está anotada, y es la que da forma a esta fase.**
`documents_select`, `document_sections_select` y `document_embeddings_select`
de `0006` exigen `is_project_member`. `match_document_sections()` es
`security invoker`. Por tanto **hoy un visitante anónimo obtiene cero filas de
RAG, siempre**. Y el visitante es la mayoría del tráfico: el producto vive en
landings públicas.

Las dos se resuelven en la misma pieza, y por eso esta fase empieza por
seguridad y no por embeddings.

## Decisión central

**La recuperación se autoriza dentro de la base de datos, contra una sesión de
visitante que está atada a un proyecto, y la única puerta es una función.**

Tiene dos mitades.

**La sesión se ata al proyecto en una tabla.** `visitor_sessions` guarda
`(user_id, project_id)` y la escribe el API con `service_role` en el mismo
acto de acuñar. Una función `security definer`, `visitor_belongs_to_project()`,
la consulta, y las políticas de `0009` pasan a exigirla. Es el patrón que el
esquema ya usa tres veces —`is_org_member`, `is_org_admin`,
`project_accepts_visitors`—, sobrevive al refresh sin hacer nada porque
`auth.uid()` no cambia, y deja rastro auditable de cada visitante.

**La lectura de documentos no pasa por un `grant`, pasa por una función.**
`match_document_sections` deja de ser `security invoker` y pasa a
`security definer`, comprobando dentro
`is_project_member(p) or visitor_belongs_to_project(p)` sobre `auth.uid()`.

Esa segunda mitad merece explicación, porque contradice en apariencia la
cabecera de `0006`.

El JWT del visitante es un JWT de Supabase, y lleva la URL del proyecto en su
propio claim `iss`. Si la salida hubiera sido añadir un
`document_sections_select_visitor` paralelo a los de `0009`, el visitante
tendría `select` sobre la tabla, y con `select` sobre la tabla puede saltarse
nuestra API e ir directo a PostgREST:

```
GET {SUPABASE_URL}/rest/v1/document_sections?project_id=eq.{id}&select=content
Authorization: Bearer {el JWT que le dimos nosotros}
```

Eso es el corpus entero del cliente en una petición. Recuperar por similitud y
volcar la documentación serían el mismo permiso.

Una función `security definer` no tiene ese problema. Su superficie es un
vector y un tope: devuelve como mucho `least(greatest(match_count, 1), 50)`
secciones por encima de un umbral de similitud. No enumera. Y la autorización
que comprueba dentro es `auth.uid()`, que viene firmado, **no un parámetro que
escribe el desarrollador en cada consulta** — que es exactamente contra lo que
advierte `0006`. La barrera no se mueve de SQL a la aplicación: se estrecha
dentro de SQL.

### Alternativas descartadas

**Política de `select` para visitantes sobre `document_sections`.** Es lo
consistente con `0009` a primera vista, y es la razón por la que hay que
razonarlo despacio: convierte cada JWT de visitante en una licencia de
descarga del corpus, por un camino que no pasa por nuestra API y donde por
tanto no hay rate limit, ni auditoría, ni log.

**`security definer` con `execute` solo para `service_role`.** Cerraría el RPC
directo desde el navegador y dejaría rate limit y auditoría donde deben estar.
Pero con `service_role` llamando, `auth.uid()` dentro de la función es null, y
el id del usuario tendría que entrar como parámetro. Un parámetro de
autorización que escribe la aplicación no es una autorización: es la misma
regla que `0008` aplica a `leads` y `0010` a los triggers de tenant.

**Claim `app_metadata.project_id` en el JWT en vez de tabla.** Comprobación a
coste cero: RLS lee `auth.jwt()`. Obliga a un `admin.updateUserById()` más un
refresco después de `signInAnonymously()`, y a confiar en que el claim
sobreviva intacto a cada refresh. `user_metadata` queda descartado sin
discusión: el propio visitante lo reescribe con `auth.updateUser()`. La tabla
es más simple y no depende de la semántica de emisión de tokens. El hook de
access token que inyecta el claim desde la tabla sigue siendo una optimización
válida si algún día la consulta por política pesa; no hace falta hoy.

**Recuperación por tool-calling, que el modelo decida si busca.** Es F4. Aquí
la recuperación es incondicional y el modelo no tiene voz en ella.

## Arquitectura

```text
Panel / API                       ingest-worker (Cloud Run)
 └─ POST …/documents                └─ claim_next_document()  ← RPC, service_role
      ├─ sube a Storage                  │  update … for update skip locked
      │  bucket privado                  ▼
      └─ insert documents           extracción · PDF | MD | TXT
         status = 'pending'  ──────▶     ▼
                                    chunking          → document_sections
                                         ▼
                                    EmbeddingProvider → document_embeddings
                                    (fake | openrouter)    (section_id, model)
                                         ▼
                                    status = 'ready' | 'failed' + failure_reason


Visitante en la landing
 └─ tess-web-component → tess-client → services/api
                                          └─ http/messages.route
                                               1  insert mensaje del usuario
                                               2  título
                                               3  emitir `thinking`
                                              3b  RAG (degrada si falla)
                                                   ├ EmbeddingProvider
                                                   └ match_document_sections()
                                                        security definer
                                                        is_project_member
                                                     OR visitor_belongs_to_project
                                               4  componer prompt · hueco 6
                                              4b  emitir `assistant.source`
                                               5  ModelProvider → `speaking`
                                               6  deltas
                                               7  persistir con `sources`
```

Dos servicios, y la frontera entre ellos es `documents.status`. El worker no
expone HTTP y el API no procesa archivos. **La ingesta nunca ocurre dentro de
una petición interactiva**, que es lo que el roadmap exige de esta fase.

### Migraciones

Tres, y el orden no es negociable: la seguridad va antes que la funcionalidad
que la necesita.

| Migración               | Qué trae                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `0012_visitor_sessions` | tabla, `visitor_belongs_to_project()`, y el `alter policy` sobre `0009` |
| `0013_rag_access`       | `match_document_sections` con `p_model` y `security definer`            |
| `0014_ingest_storage`   | bucket privado, políticas de `storage.objects`, `claim_next_document()` |

Ninguna edita una migración anterior. `0013` es la única que borra algo —la
firma vieja de `match_document_sections`— y lo hace explícitamente, por la
razón que se explica ahí.

## La condición de entrada · `visitor_sessions`

Esto es lo primero que se implementa, antes que cualquier embedding. El
roadmap lo deja escrito: «es condición de entrada de F3, no un recordatorio».

### `0012_visitor_sessions.sql`

```sql
-- Una sesión de visitante pertenece al proyecto donde se acuñó. Punto.
create table public.visitor_sessions (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create index visitor_sessions_project_id_idx on public.visitor_sessions (project_id);

alter table public.visitor_sessions enable row level security;

-- Nadie la lee por PostgREST. La escribe service_role al acuñar y la consultan
-- funciones security definer. Sin grants y sin políticas: RLS activo sin
-- política alguna deniega a todo el mundo, que es justo lo que queremos.
revoke all on public.visitor_sessions from anon, authenticated;

create or replace function public.visitor_belongs_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.visitor_sessions s
    where s.user_id = (select auth.uid())
      and s.project_id = p_project_id
  );
$fn$;

revoke all on function public.visitor_belongs_to_project(uuid) from public, anon;
grant execute on function public.visitor_belongs_to_project(uuid) to authenticated;
```

`primary key (user_id)` y no una clave compuesta: un usuario anónimo pertenece
a un proyecto y solo a uno. Si el mismo navegador abre la landing de otro
cliente, se acuña una sesión distinta con otro `auth.uid()`. Esa es la
propiedad que queremos, no un efecto secundario.

### Las políticas de `0009` se estrechan

En la misma `0012`, y con `alter policy`: `0009` no se edita, igual que `0009`
no editó `0006`. Cada política de visitante gana un `and`. Ninguna se relaja.

| Política                       | Antes                          | Después                                        |
| ------------------------------ | ------------------------------ | ---------------------------------------------- |
| `projects_select_visitor`      | `project_accepts_visitors(id)` | `… and visitor_belongs_to_project(id)`         |
| `conversations_select_visitor` | `…(project_id)` + `user_id`    | `… and visitor_belongs_to_project(project_id)` |
| `conversations_insert_visitor` | ídem                           | ídem                                           |
| `conversations_update_visitor` | ídem                           | ídem                                           |
| `messages_select_own`          | ídem                           | ídem                                           |
| `messages_insert_own`          | ídem                           | ídem                                           |
| `leads_*_visitor`              | ídem                           | ídem                                           |

Estrechar una política no es renegociar un contrato congelado: el modelo de
identidad de tres roles que congela F2 sigue siendo el mismo, y la forma de la
API no cambia. Lo que cambia es que deja de ser cierto que cualquier visitante
valga en cualquier proyecto.

### `mintVisitorSession` se ensancha

Hoy es `mintVisitorSession(): Promise<VisitorSession>`. Pasa a recibir el
proyecto y la organización, que `visitor-sessions.route.ts` ya tiene en la mano
en `settings`, y escribe la fila **antes de devolver el token**. El orden
importa por la misma razón que importa en el minteo: un cliente rápido que
recibiera el token antes de existir la fila se comería un 404 en su primera
petición.

```ts
mintVisitorSession(input: { projectId: string; organizationId: string })
  : Promise<VisitorSession>
```

El refresco no toca la tabla salvo `last_seen_at`: `auth.uid()` no cambia, así
que la fila ya es correcta.

**Sin backfill.** F2 nunca salió de local, así que no hay sesiones de
visitante en producción que se queden huérfanas. En local, `supabase db reset`.
Si alguna sesión anterior sobreviviera, su síntoma es un 404 al abrir
conversación y su remedio es reacuñar.

## Proveedor de modelos · OpenRouter por REST

F2 eligió Vercel AI Gateway. F3 lo sustituye por **OpenRouter**, por la razón
que motivaba al Gateway y que OpenRouter cumple igual: una sola credencial y
una sola factura para chat y embeddings, sin cuentas separadas por proveedor.

### La decisión de implementación: `fetch`, no el AI SDK

**Se llama a la API REST de OpenRouter directamente. No se añade
`@openrouter/ai-sdk-provider`, y se eliminan `ai` y `@ai-sdk/gateway`.**

El motivo es concreto y medible. `@openrouter/ai-sdk-provider@3.1.0` declara
`peerDependencies: { ai: "^7.0.0" }`, y el repo está en `ai@^5.0.94`
(`pnpm-workspace.yaml`). La única línea del adaptador compatible con `ai@5` es
la `1.2.x`, que **no expone `textEmbeddingModel`** — comprobado sobre el
paquete publicado. Es decir: fijar la versión vieja daría chat pero no
embeddings, que es justo lo que motiva el cambio de proveedor.

Quedaba migrar a `ai@7`, dos majors, dentro de una fase que ya toca seguridad,
un servicio nuevo y tres migraciones. Y al mirar qué aporta el AI SDK aquí, la
respuesta es poco: `ModelProvider` ya devuelve `AsyncIterable<string>` y
`EmbeddingProvider` devuelve vectores. El adaptador solo tiene que hablar
HTTP. OpenRouter es compatible con la forma de OpenAI y su streaming es SSE,
que ya sabemos parsear.

Así que F3 se queda sin dependencias de IA en el árbol. Las interfaces internas
—que es lo que de verdad protege de un cambio de proveedor— no se tocan.

**Tool-calling no se implementa en F3.** Es F4, y entrará como ensanchamiento
aditivo del contrato.

### Chat · `agent/model-provider.openrouter.ts`

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer {OPENROUTER_API_KEY}
HTTP-Referer: {OPENROUTER_HTTP_REFERER}   opcional, atribución
X-Title: {OPENROUTER_APP_TITLE}           opcional, atribución

{ "model": "…", "messages": [...], "stream": true, "provider": { … } }
```

El parseo del SSE de vuelta tiene **tres detalles que no son opcionales**, y
que son la razón por la que este adaptador lleva su propio lector en
`agent/openrouter-stream.ts` en vez de reusar nada:

1. **OpenRouter intercala líneas de comentario SSE, `: OPENROUTER PROCESSING`,
   como keepalive para que no caiga la conexión.** No son JSON. Un parser que
   haga `JSON.parse` de todo lo que llega revienta en la primera. Se saltan
   todas las líneas que empiezan por `:`.
2. El terminador es `data: [DONE]`, que tampoco es JSON.
3. Justo antes del `[DONE]` llega un chunk extra que solo trae `usage`, sin
   `choices[0].delta.content`. Acceder a ciegas a ese camino da `undefined` y
   lo concatena como `"undefined"` en la respuesta si no se comprueba.

El delta de texto está en `chunk.choices[0].delta.content`. El modelo realmente
usado está en `chunk.model` —que puede no ser el pedido si hubo fallback— y el
id de generación viaja en la cabecera `X-Generation-Id`.

### Embeddings · `embed/openrouter.ts`

```
POST https://openrouter.ai/api/v1/embeddings
{ "model": "openai/text-embedding-3-small", "input": ["…", "…"] }
```

`input` acepta un array, así que un lote es una petición. La respuesta trae
`data[]` con `embedding` e `index`; **se reordena por `index`** y no se confía
en el orden de llegada.

**No existe un parámetro `dimensions`.** Ni la API lo documenta ni el tipado
del adaptador oficial lo tiene: se recibe el tamaño nativo del modelo. Eso
convierte una restricción que parecía de configuración en una restricción de
esquema: **el modelo de embeddings tiene que emitir 1536 de forma nativa**,
porque la columna es `vector(1536)` y el índice HNSW está construido sobre
ella. `openai/text-embedding-3-small` los emite.

Por eso la validación no es opcional: **el worker comprueba
`embedding.length === EMBEDDING_DIMENSIONS` antes de persistir**, y falla el
documento si no cuadra. Un vector de tamaño equivocado no produce un error
bonito más adelante: produce un `insert` rechazado a mitad de la ingesta, o
—peor— un corpus que no se parece a sí mismo.

### Política de proveedores subyacentes

Centralizar en OpenRouter **no es aislar**. OpenRouter enruta a proveedores de
cómputo distintos, y por ahí pasan los prompts y los fragmentos de la
documentación privada del cliente. La configuración por defecto es
restrictiva, y viaja en el cuerpo de cada petición de chat **y de embeddings**:

```json
{
  "provider": {
    "data_collection": "deny",
    "allow_fallbacks": false,
    "require_parameters": true
  }
}
```

`allow_fallbacks: false` es deliberado en F3. Un fallback puede cambiar estilo,
adherencia al prompt, idioma y manejo de contexto largo; con Tess respondiendo
sobre documentación corporativa, preferimos un `model_unavailable` honesto a
una respuesta de un modelo que nadie aprobó. Habilitar fallbacks es una
decisión posterior y explícita, con lista aprobada.

`zdr: true` solo si el conjunto de modelos aprobado tiene endpoints
compatibles. Si no, se falla explícitamente; **no se abre a proveedores
desconocidos para mantener disponibilidad**.

### Lo que nunca sale hacia OpenRouter

`SUPABASE_SERVICE_ROLE_KEY`, JWTs, refresh tokens, datos de otro tenant,
documentos completos cuando bastan fragmentos, y datos personales que no hagan
falta para resolver la consulta. El contexto RAG se limita a las secciones que
devolvió la RPC autorizada, y **antes de llamar al modelo el API comprueba que
el `project_id` de cada sección coincide con el de la conversación**. Por eso
la función devuelve `project_id`: sin esa columna la comprobación no se puede
hacer. Es redundante con el filtro que ya hizo SQL, y se queda por la misma
razón por la que existen los triggers de `0010` y `0011` — si alguien edita la
función y rompe el filtro, esto lo caza antes de que la documentación de un
tenant acabe en el prompt de otro.

La clave se usa solo desde el backend. Nunca desde el web component.

### `ModelProvider` se ensancha, de forma aditiva

F2 congeló `ModelProvider`. Con fallbacks —aunque hoy estén desactivados— el
modelo que responde puede no ser el pedido, y eso hay que poder registrarlo.
`stream()` devuelve `AsyncIterable<string>`, así que no había por dónde
saliera. Se añade un callback opcional:

```ts
export interface ModelCallMetadata {
  requestedModel: string;
  actualModel?: string;
  provider: string;
  requestId?: string;
}

export interface ModelStreamInput {
  messages: ModelMessage[];
  signal: AbortSignal;
  onMetadata?: (meta: ModelCallMetadata) => void; // F3
}
```

Opcional, así que `createFakeModelProvider()` no cambia y sus cuatro tests
siguen valiendo. Es ensanchamiento aditivo, que es exactamente lo que el
roadmap permite sobre un contrato congelado.

### `EmbeddingProvider`

```ts
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(input: string, signal?: AbortSignal): Promise<number[]>;
  embedMany(input: string[], signal?: AbortSignal): Promise<number[][]>;
}
```

`dimensions` está en la interfaz y no solo en el entorno: quien tenga un
`EmbeddingProvider` en la mano puede validar sin leer configuración.

`fake` produce un vector determinista de `EMBEDDING_DIMENSIONS` a partir de un
hash del texto, normalizado. No se parece a un embedding real, pero cumple lo
único que los tests necesitan: el mismo texto da el mismo vector, textos
distintos dan vectores distintos, y el coseno entre un texto y sí mismo es 1.
Su `model` es `fake/deterministic-1536`, que nunca colisiona con uno real.

**El mismo provider debe usarse al ingerir y al recuperar.** Un corpus
embebido con `fake` y una pregunta embebida con `openrouter` no producen un
error: producen resultados sin sentido. Por eso `p_model` no es opcional en la
función de búsqueda.

**CI nunca llama a OpenRouter.** `MODEL_PROVIDER=fake` y
`EMBEDDING_PROVIDER=fake`.

## Storage · `0014_ingest_storage.sql`

Bucket **privado** `tess-documents`, creado por migración junto con sus
políticas sobre `storage.objects` y con `claim_next_document()` de la sección
siguiente: las tres piezas son la ingesta y viven juntas. Ruta:

```
{organization_id}/{project_id}/{document_id}/{nombre-seguro}
```

La organización va primera para que una política de Storage por prefijo sea
trivial de escribir y de leer. `documents` ya tiene
`unique (project_id, storage_bucket, storage_path)`, así que subir dos veces el
mismo archivo al mismo proyecto es un conflicto explícito y no un duplicado
silencioso.

El nombre se sanea en el API: nunca se usa el del cliente tal cual, y el
`document_id` en la ruta garantiza unicidad sin depender de él.

Políticas sobre `storage.objects`: `select` para miembros del proyecto,
resuelto contra el prefijo. **El visitante no recibe ninguna.** Nunca necesita
el archivo original: recibe secciones por la función, y una cita con título y
`documentId`, no una URL firmada. El worker escribe y lee con `service_role`.

Límite de tamaño: 25 MiB por archivo (`DOCUMENT_MAX_BYTES`), por debajo de los
50 MiB de `config.toml`. Un PDF de 25 MiB ya son varios miles de secciones.

## `services/ingest-worker`

### Estructura

```
services/ingest-worker/src/
  main.ts              bucle, señales, apagado limpio
  claim.ts             claim_next_document() y la transición de estado
  extract/
    index.ts           despacho por mime_type
    pdf.ts
    markdown.ts
    text.ts
  chunk.ts             estructural, 700/80
  embed/
    provider.ts        EmbeddingProvider
    fake.ts
    openrouter.ts
  persist.ts           secciones y embeddings, con validación de dimensión
```

Cada archivo hace una cosa y se prueba solo. `chunk.ts` y `embed/fake.ts` son
funciones puras: sus tests no tocan ni red ni base.

### El ciclo

El worker es un bucle que reclama, procesa y vuelve. Reclamar es atómico y por
eso es un RPC y no un `update` desde `supabase-js`: `for update skip locked` no
se expresa por PostgREST. Va en `0014_ingest_storage.sql`.

```sql
create or replace function public.claim_next_document()
returns public.documents
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  doc public.documents;
begin
  update public.documents
     set status = 'processing', updated_at = now()
   where id = (
     select d.id
       from public.documents d
      where d.status = 'pending'
      order by d.created_at
        for update skip locked
      limit 1
   )
  returning * into doc;

  return doc;
end;
$fn$;

revoke all on function public.claim_next_document() from public, anon, authenticated;
-- Solo el worker. service_role no necesita grant explícito, pero la revocación
-- al resto sí es explícita: quién puede reclamar trabajo es una decisión.
```

`skip locked` es lo que permite levantar N instancias del worker en Cloud Run
sin coordinarlas. Dos instancias nunca reclaman el mismo documento y ninguna
espera a la otra.

Sin trabajo pendiente, el worker duerme `INGEST_POLL_INTERVAL_MS` con jitter y
reintenta. Con trabajo, encadena sin dormir.

**Reprocesar es idempotente.** Antes de escribir secciones nuevas, el worker
borra las del documento. `document_embeddings` cuelga de `section_id` con
`on delete cascade`, así que se van con ellas. Un documento a medias que se
reclama otra vez no deja secciones huérfanas de una pasada anterior.

### Extracción

Tres formatos, un solo extractor de verdad.

| `mime_type`       | Extractor                                          |
| ----------------- | -------------------------------------------------- |
| `application/pdf` | `pdf-parse` o equivalente sin binarios nativos     |
| `text/markdown`   | el propio texto; los encabezados guían el chunking |
| `text/plain`      | el propio texto                                    |

Cualquier otro `mime_type` es `failed` con `failure_reason` explicando el
formato, no una excepción. Un formato no soportado es una respuesta, no un
fallo del servicio.

Un PDF de solo imágenes extrae cadena vacía. Eso también es `failed`, con
`failure_reason: 'sin texto extraíble; ¿es un PDF escaneado?'`. OCR está fuera
de alcance.

### Chunking · estructural, 700 tokens con 80 de solape

Se parte primero por la estructura que el documento ya tiene —encabezados en
Markdown, saltos de página y párrafos en PDF— y se rellena hasta 700 tokens
**sin cruzar una frontera de encabezado**. Solo se corta por tokens cuando un
bloque por sí solo excede el tope. Solape de 80 tokens entre secciones
contiguas del mismo bloque.

La razón es la cita: apunta a algo que es una unidad de sentido, que es lo que
hace que «lo sacó de aquí» signifique algo para quien la lee.

Cada sección conserva `ordinal`, `content`, `token_count` y, en `metadata`, el
`heading_path` — la ruta de encabezados que la contiene. Eso da contexto a la
cita sin una columna nueva.

**700 y 80 son puntos de partida, no una garantía universal.** Viven en
`chunk.ts` como constantes con nombre y comentario, no en el entorno:
cambiarlas invalida el índice y debe ser un commit revisable, no una variable
que alguien toca en Cloud Run.

### Fallos: un intento, sin reintento automático

Un documento que falla queda `failed` con un `failure_reason` legible y
saneado —sin rutas internas, sin trazas, sin contenido del documento— y un
humano decide. Un PDF corrupto no mejora reintentándolo.

Lo que sí es obligatorio: **el worker nunca deja un documento en `processing`
para siempre**. Un `try/finally` garantiza la transición a `ready` o `failed`
pase lo que pase.

Un `429` de OpenRouter sí admite un reintento acotado **dentro de la misma
petición** —un par de intentos con backoff—, que es distinto de reencolar el
documento. `retry_count` y el reencolado manual quedan anotados como mejora
posterior, en la deuda de F5.

## `services/api`

### `rag/retrieval.ts`

Los cuatro archivos de `src/rag/` dejan de ser `export {}`. Tres bastan, y
cambian de nombre respecto al scaffold: `retrieval.ts`, `prompt-context.ts` y
`citations.ts`. **`permissions.ts` se borra**, porque después de esta decisión
los permisos de RAG no viven en TypeScript: viven dentro de
`match_document_sections`. Un archivo llamado `permissions.ts` que no contiene
la comprobación de permisos es peor que no tenerlo.

```ts
export interface RetrievedSection {
  sectionId: string;
  documentId: string;
  documentTitle: string;
  projectId: string; // para la comprobación redundante de abajo
  ordinal: number;
  content: string;
  similarity: number;
}

export async function retrieve(input: {
  client: SupabaseClient; // el del usuario, con SU JWT
  projectId: string;
  question: string;
  embedder: EmbeddingProvider;
  matchCount: number;
  threshold: number;
  signal: AbortSignal;
}): Promise<RetrievedSection[]>;
```

Se llama con `app.userClient(request.auth.token)`, **no con `service_role`**.
La función es `security definer` pero lee `auth.uid()`, así que el JWT de quien
pregunta tiene que llegar hasta ella. Llamarla con `service_role` no daría más
resultados: daría cero, porque `auth.uid()` sería null y ni
`is_project_member` ni `visitor_belongs_to_project` se cumplirían. Ese es
exactamente el comportamiento que queremos de un fallo por descuido.

### `0013_rag_access.sql`

```sql
-- create or replace NO cambia la lista de argumentos: crearía una sobrecarga y
-- dejaría viva la versión insegura. Se borra primero, a propósito.
drop function if exists public.match_document_sections(
  extensions.vector, uuid, integer, double precision
);

create function public.match_document_sections(
  query_embedding      extensions.vector(1536),
  p_project_id         uuid,
  p_model              text,
  match_count          integer default 8,
  similarity_threshold double precision default 0.5
)
returns table (
  section_id     uuid,
  document_id    uuid,
  document_title text,      -- nuevo: la cita necesita un título que enseñar
  project_id     uuid,      -- nuevo: para que el API vuelva a comprobarlo
  ordinal        integer,
  content        text,
  similarity     double precision,
  metadata       jsonb
)
language sql
stable
security definer           -- cambia respecto a 0007. Ver la decisión central.
set search_path = ''
as $fn$
  select
    s.id, s.document_id, d.title, s.project_id, s.ordinal, s.content,
    1 - (e.embedding operator(extensions.<=>) query_embedding),
    s.metadata
  from public.document_embeddings e
  join public.document_sections s on s.id = e.section_id
  join public.documents d on d.id = s.document_id
  -- La autorización, dentro y sobre auth.uid(). Si es falsa, cero filas.
  where (
      public.is_project_member(p_project_id)
      or public.visitor_belongs_to_project(p_project_id)
    )
    and e.project_id = p_project_id
    and e.model = p_model
    and d.status = 'ready'
    and 1 - (e.embedding operator(extensions.<=>) query_embedding) >= similarity_threshold
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

revoke all on function public.match_document_sections(
  extensions.vector, uuid, text, integer, double precision
) from public, anon;
grant execute on function public.match_document_sections(
  extensions.vector, uuid, text, integer, double precision
) to authenticated;
```

Tres cambios sobre `0007`, y cada uno cierra algo:

**`security definer` con la comprobación dentro.** Es la decisión central.

**`p_model` obligatorio, sin valor por defecto.** `unique (section_id, model)`
dice que el esquema siempre previó vectores de varios modelos conviviendo
sobre la misma sección, pero `0007` no filtraba por `model`: el día que
convivieran dos, la búsqueda los mezclaría y las distancias dejarían de
significar nada, en silencio. Sin valor por defecto porque no hay ninguno
correcto: quien pregunta tiene que saber con qué modelo embebió.

**`d.status = 'ready'`.** Un documento a medio procesar tiene secciones y
embeddings escritos, y no debe citarse hasta estar completo.

### Cambiar de modelo de embeddings

Convivencia con corte explícito, y `p_model` es lo que la hace posible:

1. El corpus vive con `model = A`. `OPENROUTER_EMBEDDING_MODEL=A` en API y
   worker.
2. Se reindexa con `B`: el worker escribe filas nuevas **junto a** las de `A`,
   que el `unique (section_id, model)` permite. La búsqueda sigue sirviendo con
   `A` todo el tiempo, sin ventana ciega.
3. Se valida la calidad y la dimensión de `B`.
4. Cuando `B` está completo, se cambia la variable en **ambos servicios, en el
   mismo despliegue**. Un despliegue donde API y worker discrepen es un corpus
   que no se parece a sí mismo.
5. El rollback es cambiarla de vuelta, porque `A` sigue ahí.
6. Borrar `A` es una limpieza posterior y deliberada.

El índice HNSW es uno solo sobre `embedding` y cubre ambos modelos. Con dos
conviviendo, el filtro `e.model = p_model` se aplica después del recorrido del
índice, así que la recuperación es algo menos eficiente durante la transición.
Es aceptable: la transición es temporal y medible.

**Si el modelo nuevo no emite 1536, esto no aplica.** No basta con cambiar una
variable: hay que migrar la columna `vector(1536)`, el índice HNSW, las
validaciones y la firma de la RPC. Eso es una fase de migración propia.

### Dónde entra la recuperación · dentro del stream, con degradación

Se abre el SSE, se emite `thinking`, y **entonces** se recupera. El avatar
reacciona en el mismo milisegundo que hoy.

Si la recuperación falla —OpenRouter caído, timeout de embeddings, error del
RPC— **no se cae la respuesta**:

- se registra el error técnico en el log, con `trace_id`,
- se escribe `audit_events` con `action: 'rag.retrieval.failed'`,
- se continúa **sin bloque de contexto**,
- no se emite ningún `assistant.source`,
- el modelo responde con las reglas de falta de evidencia, que ya están en el
  prompt desde F2.

Una respuesta genérica es mejor producto que un error, y un fallo temporal de
OpenRouter no debe convertir todo el chat en un error. El precio es que el
fallo es invisible para el cliente, y por eso la auditoría no es opcional: es
lo que lo hace visible para nosotros.

El `AbortSignal` del handler cancela **tanto el embedding como la llamada
posterior al modelo**. Quien cierra la pestaña no sigue gastando ni lo uno ni
lo otro.

### El prompt

`agent/prompt.ts` reserva el hueco 6 y ahí entra. `componerMensajes` recibe un
campo opcional:

```ts
export interface ComponerInput {
  systemPrompt: string | null;
  history: ModelMessage[];
  userMessage: string;
  locale: string | undefined;
  sections?: RetrievedSection[]; // F3
}
```

Opcional a propósito: sin secciones, la función se comporta exactamente como
hoy, y los nueve tests de `prompt.test.ts` siguen siendo válidos sin tocarlos.

El bloque de contexto va **después** de las reglas no anulables y del
`system_prompt`, y lleva su propia instrucción:

```
Contexto recuperado de la documentación del proyecto. Úsalo como única fuente
para datos concretos. Si no contiene lo que se pregunta, dilo; no completes con
conocimiento general.

[1] {título} · sección {ordinal}
{contenido}

[2] …
```

Las etiquetas `[n]` **no** son para que el modelo las escriba en la respuesta.
Las citas viajan por `assistant.source`, que es un evento aparte, y no como
marcadores incrustados en el texto: el texto es lo que el usuario lee y el
componente ya lo renderiza tal cual. Que la numeración exista en el prompt
sirve para que el modelo pueda distinguir fuentes entre sí al razonar.

### Las citas · una por documento, antes del primer delta

Tras recuperar y **antes de arrancar el modelo**, se emite un
`assistant.source` por cada **documento** distinto, sin `sectionId`. El usuario
ve de dónde va a salir la respuesta mientras se escribe, que es el momento en
que le sirve. Una por documento porque cuatro secciones del mismo PDF son una
sola fuente para quien lee.

`messages.sources` se persiste con el **detalle completo de secciones** —
`[{ documentId, sectionId, title }]`, que es lo que el comentario de `0004` ya
describe—, porque ahí sí importa el detalle para el panel futuro. Lo que se
emite es un resumen; lo que se guarda es el registro.

Persistir `sources` obliga a ensanchar `insertAssistantMessage` con un campo
`sources` opcional. Aditivo, y el resto de sus llamantes no cambia.

### Subida de documentos

```
POST /v1/projects/:projectId/documents    multipart/form-data
GET  /v1/projects/:projectId/documents
```

Solo miembros. `documents.route.ts` ya existe con un `TODO` etiquetado
`fase-2` por error; es de esta fase.

El `insert` en `documents` va con el JWT del miembro, así que **`is_project_member`
decide, no un `if` en el handler**. La subida a Storage sí usa `service_role`,
porque el bucket es privado y el worker tiene que poder leerlo después.

El endpoint:

- valida el MIME real, no solo la extensión declarada,
- limita el tamaño a `DOCUMENT_MAX_BYTES` antes de leer el cuerpo entero,
- genera una ruta segura y rechaza cualquier intento de path traversal,
- **no acepta `organization_id` del cliente**: lo deriva del proyecto, igual
  que `0008` hace con `leads` y `0010` con los triggers,
- crea la fila como `pending`.

El `GET` existe porque sin él un documento que falla es invisible: devuelve
`status` y `failure_reason`.

El panel admin sigue fuera de F3 — es F5 —, pero el contrato HTTP que
consumirá ya queda escrito.

### Cuando no se recupera nada

Se contesta **sin bloque de contexto**. El prompt queda exactamente como en F2
y las reglas no anulables hacen su trabajo: no inventar, decirlo con
transparencia. Cero eventos `assistant.source`.

No se añade un mensaje fijo ni se le dice al modelo «no hay documentación»: un
saludo o una pregunta general no necesitan contexto, y forzar esa frase
produce peor conversación.

### Rate limit

Límite **por conversación** al enviar mensaje: 30 mensajes en 5 minutos. Hoy
el rate limit solo guarda `/v1/visitor-sessions`; enviar mensajes no está
limitado, y con RAG cada mensaje pasa a costar **dos** llamadas a OpenRouter.
Un solo límite en el sitio donde nacen cubre las dos.

Se mantiene la abstracción `RateLimiter` de F2 y se usa
`app.rateLimiter.consume()`. Sustituir `MemoryRateLimiter` por almacenamiento
distribuido sigue siendo deuda de F5 y es condición para Cloud Run con más de
una instancia.

**Esto no sustituye al control de gasto.** OpenRouter debe tener presupuesto y
alertas configurados aparte; un límite por conversación no protege de muchas
conversaciones.

## Entorno

```env
# Proveedores IA
MODEL_PROVIDER=fake                    # fake | openrouter
EMBEDDING_PROVIDER=fake                # fake | openrouter
OPENROUTER_API_KEY=
OPENROUTER_CHAT_MODEL=
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

# Atribución opcional en OpenRouter
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Tess

# RAG
EMBEDDING_DIMENSIONS=1536
RAG_MATCH_COUNT=8
RAG_SIMILARITY_THRESHOLD=0.5

# Documentos
DOCUMENTS_BUCKET=tess-documents
DOCUMENT_MAX_BYTES=26214400

# Worker
INGEST_POLL_INTERVAL_MS=5000
```

Desaparecen `AI_GATEWAY_API_KEY` y el valor `gateway` de `MODEL_PROVIDER`.

`loadEnv` gana estas validaciones cruzadas, en la línea de la que ya hace con
`MODEL_PROVIDER`:

- `MODEL_PROVIDER=openrouter` exige `OPENROUTER_API_KEY` y
  `OPENROUTER_CHAT_MODEL`.
- `EMBEDDING_PROVIDER=openrouter` exige `OPENROUTER_API_KEY` y
  `OPENROUTER_EMBEDDING_MODEL`.
- `OPENROUTER_CHAT_MODEL !== OPENROUTER_EMBEDDING_MODEL`. Caza solo el error
  más tonto, pero es gratis.
- `EMBEDDING_DIMENSIONS === 1536` mientras el esquema siga en `vector(1536)`.
  Un valor distinto no es una configuración, es un error que se manifestaría
  como `insert` rechazados en producción. Un servicio que no arranca es mejor.

El arranque **no consume una llamada de modelo** para comprobar nada. La
dimensión real se verifica en el worker antes de insertar vectores y en el
smoke test manual.

### Modelo fijado, no alias

`OPENROUTER_CHAT_MODEL` se fija a `proveedor/modelo-versión` explícito. Un
alias puede cambiar de comportamiento sin un despliegue nuestro, y con Tess
respondiendo documentación corporativa eso es un cambio de producto sin
revisión.

## Observabilidad

Por cada llamada a OpenRouter se registra:

```
provider · requestedModel · actualModel · requestId · trace_id · latency_ms
tokens de entrada y salida si vienen · embedding_count
retrieved_sections · retrieved_documents · fallback_used · error_code
```

`actualModel` importa porque puede no ser el pedido. Sale del `chunk.model` de
la respuesta, por la vía del `onMetadata` que se añade a `ModelProvider`.

**Nunca al log ni a Sentry:** el prompt completo, el contenido de los
documentos, correos completos, tokens ni claves. Esto continúa la regla que
`plugins/supabase.ts` ya aplica a `recordAuditEvent` —«IDs y códigos, nunca el
texto de la conversación»— y que F5 formalizará con el scrubbing de PII.

Alertas que F5 configurará, y que esta fase deja con datos que medir: subida de
`model_unavailable`, fallos de embeddings, uso de fallback, p95 de latencia,
coste por proyecto, y documentos en `failed`.

## Contratos que congela F3

| Contrato                                         | Dónde vive                                      |
| ------------------------------------------------ | ----------------------------------------------- |
| Forma de la cita — `messages.sources`            | `supabase/migrations/0004` (columna ya existe)  |
| Estrategia de chunking                           | `services/ingest-worker/src/chunk.ts`           |
| `EmbeddingProvider`                              | `services/ingest-worker/src/embed/provider.ts`  |
| Firma de `match_document_sections` con `p_model` | `supabase/migrations/0013_rag_access.sql`       |
| Binding de sesión de visitante                   | `supabase/migrations/0012_visitor_sessions.sql` |
| `ModelCallMetadata`                              | `services/api/src/agent/model-provider.ts`      |

## `tess-types`, `tess-client`, `tess-web-component`

Poco, y a propósito. `assistant.source` está tipado desde F1 y el parser SSE de
`tess-client` ya lo reenvía sin saber qué es: es un evento más del tipo unión.

- **`tess-types`**: esquemas zod para subir y listar documentos, en `api.ts`.
  `chatMessageSchema` gana `sources` opcional, para que al recargar el
  historial las citas vuelvan.
- **`tess-client`**: nada obligatorio. Los métodos de documentos son del panel,
  no del widget, y meterlos en el cliente del widget engordaría el bundle sin
  que nadie los llame.
- **`tess-web-component`**: renderiza las citas recibidas bajo el mensaje del
  asistente, como una lista de títulos. **El bundle no debe crecer más de
  5 kB**; hoy son 214.2 kB y el presupuesto del gate es 250 kB. Las citas van
  dentro del `aria-live` que ya existe, anunciadas después del texto, no
  interrumpiéndolo.

## Testing

**Unitarios, sin red ni base.**

- `chunk.ts` — el solape es el esperado, no se cruzan encabezados, un documento
  vacío da cero secciones, un bloque mayor que el tope se corta por tokens.
- `embed/fake.ts` — determinismo y dimensión.
- El parser SSE de OpenRouter — **salta `: OPENROUTER PROCESSING`**, ignora el
  chunk final de `usage` sin `delta.content`, y termina en `[DONE]`. Se prueba
  con un stream fabricado, sin red.
- El bloque de contexto del prompt — que va después de las reglas no anulables,
  y que **sin secciones el prompt es byte a byte el de F2**.

**Integración del worker, contra Supabase local.** Un `.md` sembrado se
procesa de `pending` a `ready` con sus secciones y embeddings. Un `mime_type`
no soportado acaba en `failed` con razón. Un vector de dimensión equivocada
acaba en `failed` y no se persiste. Reprocesar dos veces deja el mismo número
de secciones, no el doble. Dos reclamaciones concurrentes no se pisan. Un
documento nunca se queda en `processing`.

**RLS, que es donde se demuestra la fase.** Se añaden a `rls.test.ts`, que ya
tiene 11 casos con proyectos A y B montados:

1. Un visitante del proyecto A **no** recupera secciones del proyecto B, ni por
   el API ni llamando a `match_document_sections` directamente con el id de B.
   Este es el test que el roadmap exige por escrito.
2. Un visitante del proyecto A **sí** recupera las de A.
3. Un visitante **no** puede leer `document_sections` por PostgREST, ni
   siquiera las de su propio proyecto. Es el test que justifica la decisión
   central; si falla, el diseño no sirve.
4. Un visitante del proyecto A **no** puede abrir conversación en el proyecto
   B — la condición de entrada, ahora cerrada. **Se escribe primero y se ve
   fallar contra el esquema actual**, porque hoy pasa, y esa es la prueba de
   que el test prueba algo.
5. Un miembro de la organización A no recupera secciones de la B.
6. `match_document_sections` con `service_role` devuelve cero filas.
7. Un documento en `pending` no se cita; el mismo en `ready`, sí.
8. Embeddings de dos modelos conviviendo: buscar con `p_model = A` no devuelve
   ninguna fila de `B`.

**Extremo a extremo, manual, en el gate.** Subir un PDF de verdad, verlo pasar
a `ready`, preguntar desde la demo Svelte y comprobar que llega
`assistant.source` con el documento correcto.

## Preflight bloqueante

Antes de empezar, igual que F2 necesitó las signing keys asimétricas:

1. Una cuenta de OpenRouter con **saldo**, y una clave para desarrollo.
2. Confirmar en el catálogo que `openai/text-embedding-3-small` está
   disponible y **emite 1536**, con una llamada manual a
   `POST /api/v1/embeddings` comprobando `data[0].embedding.length`.
3. Elegir y fijar `OPENROUTER_CHAT_MODEL` a una versión explícita.
4. Configurar presupuesto y alerta de gasto en OpenRouter.

Los puntos 17 y 18 del gate no se pueden cumplir sin esto. El resto de la fase
sí se desarrolla entera con `fake`.

## Gate de salida

`pnpm gate:f3` = `gate:f2` más el worker. Se cumple cuando:

1. `gate:f2` en verde: build, test, typecheck, lint, y `tess.global.js` por
   debajo de 250 kB y limpio.
2. El worker procesa PDF textual, Markdown y TXT.
3. Un documento pasa de `pending` a `ready` sin intervención.
4. Los embeddings persistidos tienen exactamente 1536 dimensiones, validado
   antes de insertar.
5. API y worker usan el mismo modelo de embeddings.
6. RLS impide recuperar documentos de otro proyecto.
7. Un visitante del proyecto A recupera solo de A.
8. Un visitante no puede leer `document_sections` por PostgREST.
9. `assistant.source` llega antes del primer `assistant.delta`.
10. `messages.sources` conserva el detalle de secciones.
11. Si el RAG falla, el chat degrada sin citas y deja `rag.retrieval.failed` en
    `audit_events`.
12. Una fuente por documento, no una por sección.
13. El endpoint de subida solo acepta miembros.
14. Un MIME no soportado marca `failed` sin tumbar el worker.
15. El rate limit de 30 mensajes / 5 minutos por conversación aplica.
16. **CI sigue usando providers `fake` y no llama a OpenRouter.**
17. Un smoke test manual con OpenRouter produce streaming real.
18. Ese smoke test verifica la dimensión del embedding y registra el modelo
    realmente usado.
19. La ingesta no ocurre dentro de ninguna petición HTTP — verificable leyendo
    que `services/api` no importa nada de `extract/`, `chunk.ts` ni
    `persist.ts`.

## Fuera de alcance

- **Tool-calling.** F4, por ensanchamiento aditivo del contrato.
- **OCR.** Un PDF escaneado es `failed` con razón, no un problema a resolver.
- **Reranking.** La similitud coseno decide, sin segunda pasada.
- **Búsqueda híbrida léxica + vectorial.** El esquema no tiene índice de texto
  completo y añadirlo es una fase en sí.
- **Fallbacks de modelo activos.** `allow_fallbacks: false` en F3. Habilitarlos
  es una decisión posterior con lista aprobada.
- **Migrar a `ai@7`.** No se hace en F3. Si F4 quiere el ecosistema del AI SDK
  para tool-calling, será su decisión y su alcance.
- **Panel admin.** F5, y con él la deuda 2 que hereda F2.
- **`MemoryRateLimiter` respaldado por Redis.** Deuda 1 de F2, sigue siendo F5.
- **Crawling de URLs.** Un subsistema, no un formato.
- **Citas con fragmento resaltado o enlace profundo al PDF.** La cita de F3 es
  título y `documentId`.

## Deuda que F3 dejaría planteada

1. `retry_count` y reencolado manual de documentos en `failed`. F3 hace un solo
   intento a propósito.
2. El índice HNSW usa `m = 16, ef_construction = 64`, los valores por defecto
   de `0003`, sin haberlos medido con datos reales.
3. Durante una convivencia de dos modelos, el filtro `e.model` se aplica
   después del recorrido del índice. Medible y temporal, pero real.
4. `EMBEDDING_DIMENSIONS` está clavado a 1536 por la columna y el índice.
   Cambiar a una familia de embeddings con otra dimensión exige migrar columna,
   índice, validaciones y RPC: es una fase propia.
5. Política de proveedores de OpenRouter: `data_collection: deny` y sin
   fallbacks es el default seguro, pero falta la lista aprobada por escrito y
   la decisión sobre `zdr`.
