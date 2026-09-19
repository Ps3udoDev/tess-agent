# Fase 2 — Backend de chat e identidad

Fecha: 2026-09-19
Estado: aprobado, pendiente de plan de implementación
Roadmap: `docs/roadmap-tess.md`
Fase anterior: `docs/superpowers/specs/2026-09-19-fase-1-componente-visual-design.md`

## Contexto

F1 cerró con el avatar funcionando y sin red. Los cuatro paquetes visuales
existen, `pnpm gate:f1` pasa, y el diálogo se abre vacío a propósito.

`services/api` sigue siendo el andamio del scaffold: `main.ts` levanta Fastify
con `/health` y nada más. Las ocho rutas y módulos de `src/http`, `src/agent`,
`src/rag` y `src/connectors` son archivos con `export {}` y un
`TODO(fase-2)`.

Las doce tablas base están migradas, sembradas y con RLS activo desde antes de
F1. F2 **no las reescribe**: añade dos migraciones encima.

F1 dejó tres cabos sueltos que esta fase recoge, y están anotados en el
roadmap: falta el atributo `project-id`, falta la UI de chat, y el plan de F1
quedó sin marcar.

## Decisión central

**El visitante anónimo es un usuario real de Supabase Auth, y su sesión la
acuña el API.**

Es la decisión de la que cuelga todo lo demás, así que conviene ser explícito
sobre el problema que resuelve.

Tess vive en landings públicas. El interlocutor típico —alguien mirando la app
de citas de un cliente— no tiene cuenta y puede que nunca la tenga. Pero el
esquema de `0006_rls.sql` está escrito para miembros: `conversations_insert`
exige `user_id = auth.uid()` **y** `is_project_member(project_id)`. Un visitante
no cumple ninguna de las dos.

La salida elegida:

```
widget ──POST /v1/visitor-sessions { publicKey }──→ API
                                                     │ 1. Origin ∈ allowed_origins
                                                     │ 2. publicKey válida y activa
                                                     │ 3. rate limit por IP
                                                     │ 4. signInAnonymously()
widget ←──── { accessToken, refreshToken, … } ───────┘

widget ──Authorization: Bearer <JWT de Supabase>──→ API ──→ RLS decide
```

Tres consecuencias, y las tres son el motivo de la decisión:

**Una sola barrera.** Visitante, usuario de la app y miembro del proyecto
llevan todos un JWT de Supabase con `auth.uid()`. RLS aplica igual a los tres.
No existe un camino que la bypasee.

**La puerta la controlamos nosotros.** Como el minteo pasa por el API,
validamos origen, clave y rate limit **antes** de crear el usuario. Sin ese
filtro esto sería llamar a `signInAnonymously()` desde el navegador, que deja a
cualquiera crear filas en `auth.users`.

**El registro posterior no cuesta nada.** Cuando el visitante decide crearse
cuenta, Supabase convierte el usuario anónimo en permanente y **`auth.uid()`
no cambia**. Sus conversaciones y su lead siguen colgando del mismo id. No hay
migración de datos ni reconciliación. Es la pieza que hace viable la
herramienta de alta de cuenta de F4.

### Alternativas descartadas

**Sesión efímera firmada por el API, escribiendo con `service_role`.** Rompe el
principio que ya está escrito en la cabecera de `0006_rls.sql`: _«la protección
no debe depender solamente de un filtro escrito por el desarrollador en cada
consulta»_. Para el camino del visitante —que será la mayoría del tráfico— RLS
dejaría de ser la barrera. Y al registrarse habría que migrar sus
conversaciones de un `visitor_id` a un `user_id` a mano.

**Anonymous Sign-In directo desde el navegador.** Conserva RLS y conserva el
upgrade gratis, pero deja la creación de usuarios abierta a cualquiera con la
anon key, y mete `@supabase/supabase-js` en un bundle que hoy son 208 kB sin
él.

**Solo usuarios autenticados, difiriendo el visitante.** Es lo que decía el
roadmap original. Se descarta porque convierte el producto en otro: un
asistente interno, no uno de landing.

## Arquitectura

```text
Landing del cliente
 └─ <teams4soft-assistant project-id public-key api-url>
      └─ tess-web-component ──── UI de chat
           └─ tess-client ───── fetch + parser SSE
                    │
                    │  HTTPS
                    ▼
        services/api · Fastify · Cloud Run
          ├─ plugins/auth      valida el JWT, produce request.auth
          ├─ plugins/supabase  cliente por-petición con el JWT del usuario
          ├─ http/*.route      5 rutas
          ├─ agent/            ModelProvider (fake | gateway)
          └─ domain/           conversaciones, leads, escritor SSE
                    │
                    ▼
                Supabase (RLS)
```

### La regla que gobierna el servicio

**El API consulta Supabase con el JWT de quien llama, no con `service_role`.**

Cada petición construye un cliente efímero con el token del usuario, de modo
que RLS evalúa las políticas de `0006` y `0009` como si el usuario consultara
directamente. `service_role` queda reservado a tres operaciones, cada una con
su razón:

| Operación                         | Por qué no puede ir con el JWT del usuario                              |
| --------------------------------- | ----------------------------------------------------------------------- |
| Acuñar la sesión de visitante     | Todavía no hay JWT. Es el acto de crearlo.                              |
| Insertar el mensaje del asistente | `messages_insert_own` permite solo `role = 'user'`, y eso es deliberado |
| Escribir `audit_events`           | La tabla no tiene política de `insert` para `authenticated`             |

Esas tres —y solo esas— viven en `src/plugins/supabase.ts`, detrás de funciones
con nombre (`mintVisitorSession`, `insertAssistantMessage`, `recordAuditEvent`).
El cliente `service_role` **no se exporta**. Así, buscar quién bypasea RLS es
buscar tres llamadas, no auditar todo el servicio.

## Modelo de identidad

Tres roles, y la diferencia entre ellos es una propiedad del JWT y de la
pertenencia, no una tabla aparte:

| Rol            | `auth.uid()` | `is_anonymous` | Pertenece al proyecto | Puede                                         |
| -------------- | ------------ | -------------- | --------------------- | --------------------------------------------- |
| Visitante      | sí           | `true`         | no                    | su conversación, sus mensajes, su lead        |
| Usuario de app | sí           | `false`        | no                    | lo mismo; el historial sobrevive al registro  |
| Miembro        | sí           | `false`        | sí                    | todas las conversaciones del proyecto, y docs |

Dos matices que el diseño depende de que se entiendan bien:

**Las políticas de visitante no comprueban `is_anonymous`.** A propósito. Un
usuario ya registrado de la app del cliente que pregunta en la landing es
exactamente el mismo caso de uso, y debe funcionar sin ser miembro del
proyecto.

**Un visitante no puede leer documentos, y eso ya está garantizado hoy.**
`documents_select` exige `is_project_member(project_id)`, que para él es falso.
F2 no añade ninguna política que lo permita. Cuando llegue F3 habrá que decidir
explícitamente si la recuperación se expone al anónimo; hasta entonces, el
default es «no» por construcción.

## Migraciones

### `0008_widget_leads.sql`

**Tabla nueva `project_widget_settings`.** La configuración de cara al público
vive fuera de `projects` para poder dar al visitante acceso de lectura a
`projects` sin exponerle de paso la clave y la allowlist.

```text
project_id                 uuid primary key references projects
organization_id            uuid not null references organizations
public_key                 text not null unique
allowed_origins            text[] not null default '{}'
visitor_access             boolean not null default false
collect_leads_from_members boolean not null default false
greeting                   text
created_at / updated_at
```

**`public_key` no es un secreto.** Identifica al proyecto y nada más. Viaja en
el HTML de la landing, a la vista de cualquiera. Lo que protege el endpoint son
las otras tres capas: validación de `Origin`, rate limit y, después, RLS sobre
el JWT. Conviene que quede escrito porque el prefijo `pk_` invita a tratarla
como credencial y a construir encima defensas que no son.

`collect_leads_from_members = false` por defecto: no se crean leads de
empleados ni de miembros internos salvo que alguien lo pida explícitamente.

`greeting` es el saludo que el widget pinta como primera burbuja al abrirse el
diálogo, antes de que exista ninguna conversación. Es texto plano configurado
por el cliente, no una respuesta del modelo, y por eso no se persiste como
mensaje: si el visitante cierra sin preguntar nada, no queda rastro.

RLS activo. Políticas de lectura y escritura solo para administradores de la
organización —lo necesitan para copiar la clave al integrar el widget—. El API
la lee con `service_role` en el momento de acuñar, que es antes de que exista
un JWT.

`visitor_access = false` por defecto: un proyecto no acepta anónimos hasta que
alguien lo activa a conciencia.

**Tabla nueva `leads`.**

```text
id                uuid primary key
organization_id   uuid not null references organizations
project_id        uuid not null references projects
auth_user_id      uuid not null references auth.users
email             text
full_name         text
source            text not null default 'widget'
consent_at        timestamptz
metadata          jsonb not null default '{}'
first_seen_at     timestamptz not null default now()
created_at / updated_at
unique (project_id, auth_user_id)
```

`organization_id` **no se acepta del cliente**: lo rellena un trigger
`leads_set_organization` leyendo el proyecto. Es la misma disciplina de
denormalización que ya aplica `0002`, pero aquí además evita que un cliente
declare una organización que no le corresponde.

Esa regla es general y vale para todo el API: **`organization_id`, `project_id`
y cualquier señal de permisos se derivan de la ruta, del JWT y de la fila leída
con RLS, nunca del cuerpo de la petición.** Un campo de autorización que viene
del cliente no es una autorización.

Al menos uno de `email` o `full_name` debe venir informado —`check`—, porque un
lead sin ninguno de los dos no es un lead. El API normaliza el correo
—minúsculas, sin espacios— y valida formato y longitud antes de insertar.

**`consent_at` es columna propia, no `metadata`.** Es el registro de que la
persona aceptó que le contacten: tiene valor legal, se consulta para decidir si
se le puede escribir, y probablemente haya que borrarlo o exportarlo a
petición. Un dato que se consulta y se audita no se entierra en un `jsonb`.

La atribución sí va en `metadata`, porque varía por integración y nadie filtra
por ella: `landing_url`, `referrer`, `utm_source`, `utm_medium`,
`utm_campaign`. El widget la recoge de la página anfitriona y la envía con el
lead.

**Upsert que no destruye.** Si el usuario reenvía solo el correo, el
`full_name` anterior se conserva. `coalesce` por campo, nunca un `update` que
escriba nulos encima de lo que ya había.

### `0009_visitor_rls.sql`

**Helper `project_accepts_visitors(p_project_id)`**, `security definer` y
`set search_path = ''`, exactamente el patrón de los tres helpers de `0006`.

Es `security definer` por necesidad, no por comodidad: si consultara
`project_widget_settings` con los permisos del visitante, RLS filtraría la fila
y la respuesta sería siempre falso. El mismo bucle que `0006` resuelve con
`is_org_member`.

**Políticas nuevas, paralelas a las existentes.** No se edita ninguna política
de `0006`. Las políticas se combinan con OR, así que añadir es siempre más
permisivo y nunca rompe lo que un miembro ya podía hacer.

| Tabla           | Política nueva                 | Condición                                                   |
| --------------- | ------------------------------ | ----------------------------------------------------------- |
| `projects`      | `projects_select_visitor`      | `project_accepts_visitors(id)`                              |
| `conversations` | `conversations_select_visitor` | acepta visitantes **y** `user_id = auth.uid()`              |
| `conversations` | `conversations_insert_visitor` | ídem, en `with check`                                       |
| `conversations` | `conversations_update_visitor` | ídem — necesaria para que el título se pueda rellenar       |
| `messages`      | `messages_select_visitor`      | la conversación acepta visitantes y es suya                 |
| `messages`      | `messages_insert_visitor`      | ídem, y `role = 'user'`                                     |
| `leads`         | `leads_insert_own`             | `auth_user_id = auth.uid()` y el proyecto acepta visitantes |
| `leads`         | `leads_select_own`             | `auth_user_id = auth.uid()`                                 |
| `leads`         | `leads_select_member`          | `is_project_member(project_id)`                             |

El visitante ve **solo su propia conversación**, nunca las del proyecto. El
miembro sigue viéndolas todas por la política de `0006`.

`conversations_update_visitor` no es un extra: sin ella, el paso de persistencia
que rellena `title` con el primer mensaje fallaría para todo visitante, porque
`conversations_update` de `0006` exige `is_project_member`.

`leads_select_own` tampoco es decorativa: es lo que permite al widget saber, al
recargar la página, que este visitante ya dejó sus datos y que no debe volver a
pedírselos.

`leads` se inserta con el JWT del propio visitante, no con `service_role`: la
política de `with check` ya garantiza que solo puede crear su propio lead, así
que no hay razón para bypasear RLS. El `unique (project_id, auth_user_id)` evita
duplicados.

### `supabase/config.toml`

`enable_anonymous_sign_ins` pasa de `false` a `true` (línea 177). El límite
`anonymous_users = 30` por IP y hora de la línea 202 se mantiene: es una
segunda red debajo del rate limit del API.

## `services/api`

### Estructura

Respeta el layout que ya prescribe el documento de arquitectura. Las carpetas
`rag/` y `connectors/` siguen con sus `TODO`: son F3 y F4.

```text
services/api/src/
├── main.ts                      arranque y listen
├── app.ts                       buildApp(): la app sin escuchar, para los tests
├── env.ts                       esquema zod de process.env, validado al arrancar
├── plugins/
│   ├── supabase.ts              userClient() + las tres funciones service_role
│   ├── auth.ts                  decorator authenticate → request.auth
│   ├── cors.ts
│   └── rate-limit.ts
├── http/
│   ├── health.route.ts
│   ├── visitor-sessions.route.ts
│   ├── conversations.route.ts
│   ├── messages.route.ts        ← el SSE
│   └── leads.route.ts
├── domain/
│   ├── conversations/
│   ├── leads/
│   └── assistant-events/sse-writer.ts
├── agent/
│   ├── model-provider.ts        la interfaz y el selector
│   ├── model-provider.fake.ts
│   └── model-provider.gateway.ts
└── observability/audit.ts
```

La separación `main.ts` / `app.ts` no es cosmética: `buildApp()` devuelve la
instancia sin llamar a `listen()`, que es lo que permite probar las rutas con
`app.inject()` sin abrir un puerto.

### Validación

`env.ts` valida `process.env` con zod al arrancar y **falla ruidosamente** si
falta algo. Un servicio que arranca sin `SUPABASE_SERVICE_ROLE_KEY` y revienta
en la primera petición es peor que uno que no arranca.

Las rutas validan con JSON Schema, como pide el documento de arquitectura, pero
los esquemas se escriben una sola vez en zod dentro de `tess-types` y se
convierten con `z.toJSONSchema()`. Así el cliente y el servidor comparten
definición en lugar de mantener dos copias que divergen.

### Autenticación

Un decorator `authenticate` que corre como `preHandler` en todas las rutas
salvo `/health` y `/v1/visitor-sessions`:

```ts
request.auth = { userId: string; isAnonymous: boolean; token: string };
```

La verificación usa `supabase.auth.getClaims()`, que valida la firma **en
local** contra el JWKS del proyecto y lo cachea. Importa que sea local: la
alternativa, `getUser()`, hace una llamada de red por petición y pondría a
Supabase en el camino crítico de cada mensaje.

Si el proyecto todavía usa el secreto HS256 heredado, `getClaims()` no puede
verificar en local. En ese caso la tarea correspondiente debe migrar el
proyecto a claves asimétricas desde el panel de Supabase, no caer a `getUser()`
en silencio.

### Resolución de tenant

`projectId` viaja en la ruta. Se resuelve leyendo la fila de `projects` **con el
cliente del usuario**. Si RLS no devuelve nada, la respuesta es **404, no 403**:
un 403 confirmaría que el proyecto existe, y eso es información que no le
debemos a quien no tiene acceso.

`organization_id` sale de esa misma fila. Nunca del cuerpo de la petición.

### Endpoints

#### `POST /v1/visitor-sessions`

```jsonc
// petición
{ "publicKey": "pk_live_..." }
// respuesta 201
{ "accessToken": "...", "refreshToken": "...", "expiresAt": 1789..., "userId": "uuid", "projectId": "uuid", "greeting": "¡Hola! ¿En qué te ayudo?" }
```

`greeting` viaja aquí y no en un endpoint propio porque es el único momento en
que el API ya leyó `project_widget_settings` con `service_role`. Por el camino
del host autenticado —que no pasa por aquí— el widget usa su cadena por
defecto según `locale`.

Orden de validación, y el orden importa:

1. Cabecera `Origin` presente y contenida en `allowed_origins`. Ausente o no
   listada → **403 `forbidden_origin`**.
2. `publicKey` existe y su proyecto tiene `visitor_access = true` → si no,
   **404 `project_not_found`**.
3. Rate limit por IP: 10 por minuto. Excedido → **429 `rate_limited`**.
4. Solo entonces, `signInAnonymously()`.

Los tres filtros van **antes** del minteo porque son justamente lo que evita
que esto sea una fábrica abierta de filas en `auth.users`.

Se registra un `audit_events` con `action = 'visitor.session.created'`, el
proyecto y la IP. Sin correo, sin nombre, sin contenido.

#### `POST /v1/projects/{projectId}/conversations`

Crea la conversación con `user_id = auth.uid()` y `locale` del cuerpo o del
`assistant_configs` del proyecto. Devuelve `{ conversationId }`. 201.

#### `GET /v1/projects/{projectId}/conversations/{conversationId}/messages`

Historial paginado, orden ascendente por `created_at`. RLS decide qué ve quien
pregunta. Sirve para que el widget recupere la conversación tras un recargado
de página.

#### `POST /v1/projects/{projectId}/conversations/{conversationId}/messages`

El endpoint de la fase. `Content-Type: text/event-stream`. Cuerpo:

```jsonc
{ "content": "¿Qué servicios de migración ofrecen?", "locale": "es-MX" }
```

`content` entre 1 y 4000 caracteres.

#### `POST /v1/projects/{projectId}/leads`

```jsonc
{ "email": "...", "fullName": "..." } // al menos uno
```

Inserta con el cliente del usuario. Si ya existe el lead para ese
`(project_id, auth_user_id)`, hace `upsert` de los campos informados y devuelve
200 en lugar de 201. Volver a enviar el formulario no debe ser un error.

#### `GET /v1/projects/{projectId}/me`

Todo lo que el widget necesita saber de quien está usándolo, en una sola
petición al abrir el diálogo:

```jsonc
{
  "userId": "uuid",
  "isAnonymous": true,
  "isProjectMember": false,
  "lead": null, // o { "email": "...", "fullName": "..." }
  "collectLeadsFromMembers": false,
}
```

`lead` se lee con el cliente del usuario y se apoya en `leads_select_own`: la
restricción de no ver leads ajenos es de RLS, no del handler.

`isProjectMember` es la pieza que faltaba. Sin ella el widget no puede
distinguir a un prospecto de un empleado, y acabaría pidiendo el correo a gente
que ya trabaja en la organización.

### El contrato SSE, congelado

```text
event: assistant.state      data: {"state":"thinking"}
event: assistant.state      data: {"state":"speaking"}
event: assistant.delta      data: {"text":"Teams4Soft ofrece"}
event: assistant.delta      data: {"text":" migración de..."}
event: assistant.completed  data: {"messageId":"uuid"}
```

**El servidor nunca emite `idle` ni `success`.** Emite lo que él está haciendo.
El cliente traduce el desenlace usando la maquinaria de transitorios que F1 ya
construyó:

| El cliente recibe     | Pide a `tess-core`               |
| --------------------- | -------------------------------- |
| `assistant.state`     | ese estado tal cual              |
| `assistant.completed` | `success` → vuelve solo a `idle` |
| `assistant.error`     | `error` → vuelve solo a `idle`   |

**Los tiempos no se escriben aquí.** `tess-core` ya exporta
`DEFAULT_TRANSIENT_MS`, y ni `tess-client` ni el web component deben contener
esos números literales. Quien necesite el valor lo importa; quien necesite
cambiarlo lo cambia en un sitio.

Para que conste, porque es un contrato de F1 que F2 no toca: los defaults son
`success: 1920` y `error: 2520`, medidos sobre `tess-rive/scene.rml`
—`anim_success` dura 108 frames a 60 fps, `anim_error` 144, y la transición de
salida de ambos declara `duration="120"`—. Los valores provisionales 1600/2400
que circularon antes se descartaron en F1 por quedarse cortos: habrían
devuelto el estado lógico a `idle` con la animación todavía corriendo.

Esta división es deliberada: el servidor no sabe ni debe saber cuánto dura la
animación de éxito. Reporta hechos; la capa visual decide cómo se ven.

`assistant.source` **no se emite en F2**. El tipo existe desde F1 y el cliente
debe parsearlo sin romperse, pero el productor llega en F3.

#### Mecánica

Se escribe sobre `reply.raw`, no sobre `reply.send()`, con:

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`no-transform` y `X-Accel-Buffering` existen por los proxies: sin ellos, un
intermediario puede acumular los deltas y entregarlos de golpe al final, que es
exactamente perder el streaming sin que nada dé error.

Un comentario `: ping` cada 15 segundos mantiene viva la conexión. Al cerrarse
el socket (`request.raw.on('close')`) se dispara un `AbortController` que corta
la llamada al modelo: un usuario que cierra la pestaña no debe seguir gastando
tokens.

#### Orden de persistencia

1. Insertar el mensaje del usuario con **su** cliente. Si RLS lo rechaza, la
   petición termina en **404** sin abrir el stream, por la misma razón que la
   resolución de tenant: un 403 confirmaría que esa conversación existe.
2. Si la conversación no tenía `title`, se rellena con los primeros 80
   caracteres del mensaje. Sin llamada al modelo.
3. Emitir `assistant.state: thinking`.
4. Leer los últimos 20 mensajes como contexto, más el `system_prompt` de
   `assistant_configs` o el default.
5. Arrancar el stream del modelo. **Al primer delta**, emitir
   `assistant.state: speaking`. Antes no: `speaking` significa que hay texto
   saliendo.
6. Emitir cada delta y acumular el texto.
7. Al terminar, insertar el mensaje del asistente con `service_role` y emitir
   `assistant.completed` con su id.

Si el modelo falla a mitad: se emite `assistant.error` y **se persiste lo que
sí se produjo** con `metadata.incomplete = true`. Si no llegó a producirse
nada, no se persiste. El criterio es que el historial no mienta: si el usuario
vio medio párrafo, al recargar debe seguir viéndolo.

### Errores

Un catálogo cerrado, compartido entre API y cliente:

| `code`              | HTTP | `retryable` |
| ------------------- | ---- | ----------- |
| `unauthorized`      | 401  | no          |
| `forbidden_origin`  | 403  | no          |
| `project_not_found` | 404  | no          |
| `invalid_request`   | 400  | no          |
| `rate_limited`      | 429  | sí          |
| `model_unavailable` | 502  | sí          |
| `internal`          | 500  | sí          |

Si el stream ya se abrió, el error viaja como `assistant.error`, no como código
HTTP: las cabeceras ya se enviaron con 200 y no se pueden reescribir.

`message` es texto para humanos y **no lleva detalle interno**. Lo que se
necesita para depurar va a Sentry con el `trace_id`, no al navegador.

Y lo que va a Sentry tampoco es todo: ni el prompt de sistema, ni el texto de
la conversación, ni el correo o el nombre de un lead, ni tokens. Solo
identificadores, códigos de operación, latencia y el `trace_id`. F5 endurecerá
esto con scrubbing configurado; F2 simplemente no los envía.

### `ModelProvider`

```ts
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelProvider {
  stream(input: {
    messages: ModelMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
}
```

Devuelve deltas de texto y nada más: ni tokens, ni herramientas, ni citas. F3
le añadirá contexto RAG **al prompt**, sin tocar la interfaz. F4 necesitará
herramientas, y ahí sí se ensanchará de forma aditiva.

`createFakeModelProvider()` trocea una respuesta enlatada en deltas con una
pausa configurable —cero por defecto en tests—. Es determinista, no toca la red
y no gasta crédito: es el que usan CI y los tests.

`createGatewayModelProvider()` usa `ai` + `@ai-sdk/gateway` con
`MODEL_NAME`. Lo selecciona `MODEL_PROVIDER` en el arranque.

Que el gate corra siempre con el `fake` es intencional. Un gate que depende de
la red y del crédito de un proveedor no es un gate: es una fuente de fallos
intermitentes. La conversación real contra AI Gateway es un smoke test manual
aparte, con `MODEL_PROVIDER=gateway`.

## Prompt e idioma

### Composición del prompt

El prompt de sistema se compone en este orden, y el orden es la política:

```text
1. reglas de seguridad y honestidad      ← no anulables
2. identidad y personalidad base de Tess
3. configuración del proyecto            ← display_name, tono
4. assistant_configs.system_prompt       ← lo que escribe el cliente
5. contexto de la conversación
6. contexto RAG                          ← desde F3
```

**El bloque 1 va primero y no se puede desactivar desde el bloque 4.** Un
cliente puede darle a Tess un tono, un dominio y un vocabulario; no puede
autorizarla a inventar información, revelar el prompt ni afirmar acciones que
no ejecutó. Que la configuración por proyecto sea texto libre hace esto
necesario: sin la precedencia, un `system_prompt` mal escrito desarma las
garantías del producto.

`assistant_configs.system_prompt` recibe un límite de tamaño —4000
caracteres— y su modificación queda en `audit_events`. **Nunca se imprime** en
respuestas de error, en logs ni en Sentry.

El prompt base se siembra por SQL, no se escribe en el código: así un cliente
puede verlo y ajustarlo sin un despliegue. El texto completo vive en
`supabase/seed.sql` y en la migración que crea la fila por defecto.

### Idioma

**Tess responde en el idioma en que le escriben.** `conversations.locale` es un
fallback, no una orden de contestar siempre en español.

Prioridad:

```text
1. idioma evidente del mensaje actual
2. conversations.locale
3. es-MX
```

La detección del idioma dominante de toda la conversación queda fuera de F2:
añade complejidad y el prompt ya maneja bien el caso frecuente. Si el usuario
cambia de idioma a mitad de conversación, Tess sigue el del mensaje actual,
salvo que haya pedido explícitamente mantener otro.

La instrucción de idioma la inyecta el backend en el contexto. **No se confía
solo en el `locale` que manda el navegador**, que es un dato del cliente y
puede no tener nada que ver con lo que la persona acaba de escribir.

`locale` sigue controlando las cadenas de UI y los `aria-label` del widget, que
es para lo único que lo usaba F1.

Tests obligatorios, con el provider fake configurado para reflejar la
instrucción de idioma recibida:

```text
mensaje en español  + locale es-MX → responde en español
mensaje en inglés   + locale es-MX → responde en inglés
mensaje en portugués + locale es-MX → responde en portugués
mensaje ambiguo («ok») + locale es-MX → usa el locale
```

## Rate limiting

```ts
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}
```

F2 implementa el adaptador **en memoria**, que es suficiente en local y en
tests. Pero un contador en memoria en Cloud Run cuenta por instancia, así que
con tres instancias el límite real es el triple del configurado. Por eso se
define como interfaz desde ahora: sustituirla por Redis o Memorystore antes de
producción es cambiar una implementación, no reescribir las rutas.

Mientras tanto, el límite de `anonymous_users = 30` por IP y hora que Supabase
aplica en `config.toml` sigue siendo la segunda barrera, y esa sí es global.

## `tess-types`

Los esquemas zod entran en `src/api.ts`, que es el `TODO(fase-2)` que ya está
escrito en `index.ts`.

**Pero no se exportan desde el entry point principal.** `tess-types` ya declara
`zod` como dependencia, y el web component importa de `tess-types` valores en
runtime (`SIZES`, `THEMES`, `isRequestedState`, `TAG_NAME`). Hoy zod queda
fuera del bundle porque nadie lo usa; en cuanto `index.ts` exporte un esquema,
entra.

Por eso `api.ts` sale por un entry point propio:

```jsonc
"exports": {
  ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./api":    { "types": "./dist/api.d.ts",   "import": "./dist/api.js" }
}
```

El API y `tess-client` importan de `@teams4soft/tess-types/api`; el web
component sigue importando de la raíz y su bundle sigue sin zod.
`scripts/check-bundle.mjs` gana una comprobación para que esto no se
recupere por accidente.

### `TessClientLike` se ensancha

F1 afirmó que en F2 cambiaría «solo la implementación». Era optimista: la UI de
chat necesita crear la conversación, leer el historial y enviar el lead, y
`TessClientLike` solo declara `sendMessage`.

La corrección menos invasiva son métodos **opcionales**, con lo que
`createNoopTessClient()` sigue siendo válido tal cual está:

```ts
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO 8601
  incomplete?: boolean; // el stream se cortó a mitad
}

export interface LeadInput {
  email?: string;
  fullName?: string;
  attribution?: Record<string, string>; // landing_url, referrer, utm_*
}

export interface TessViewer {
  userId: string;
  isAnonymous: boolean;
  isProjectMember: boolean;
  lead: LeadInput | null;
  collectLeadsFromMembers: boolean;
}

export interface TessClientLike {
  sendMessage(input: SendMessageInput): AsyncIterable<AssistantStreamEvent>;
  createConversation?(): Promise<{ conversationId: string }>;
  listMessages?(conversationId: string): Promise<ChatMessage[]>;
  getViewer?(): Promise<TessViewer>;
  submitLead?(input: LeadInput): Promise<{ leadId: string }>;
}
```

`ChatMessage` no expone `system` ni `tool` aunque `message_role` los admita en
la base: son turnos internos que el navegador no debe ver. El filtrado ocurre
en el API, no en el cliente.

`getViewer()` es una sola llamada a `GET /me` al abrir el diálogo. Se prefiere
a un `getLead()` suelto porque el widget necesita tres datos a la vez —si es
miembro, si ya hay lead, y si el proyecto quiere leads de miembros— y pedirlos
por separado invita a decidir con información incompleta.

`SendMessageInput` no cambia: `conversationId` sigue siendo obligatorio y el
componente crea la conversación antes del primer envío.

## `tess-client`

```ts
export interface TessClientOptions {
  apiUrl: string;
  projectId: string;
  publicKey?: string; // para acuñar sesión de visitante
  getToken?: () => string | Promise<string>; // si el host ya tiene sesión
  storage?: TessSessionStorage; // inyectable para tests
}

export function createTessClient(options: TessClientOptions): TessClientLike;
```

Si el host provee `getToken`, se usa esa sesión y `publicKey` sobra: es el caso
del panel admin y de una app que ya autenticó a su usuario. Si no, el cliente
acuña una sesión de visitante con `publicKey`. Sin ninguno de los dos, falla al
construirse con un mensaje explícito.

**Por qué `fetch` y no `EventSource`.** `EventSource` solo hace GET y no admite
cabeceras propias, así que no puede llevar el `Authorization` ni el cuerpo del
mensaje. El cliente hace `fetch` con `POST` y parsea el `ReadableStream` a
mano. El parser de `text/event-stream` vive en `src/sse.ts`, separado del
transporte, y es lo que más test unitario recibe: trama partida a mitad de una
línea, `data:` multilínea, comentarios `:` de heartbeat y el delimitador de
línea en blanco.

**Eventos desconocidos no rompen el parser.** Si llega un `event:` que el
cliente no reconoce, se ignora y el stream continúa. Esto no es defensa
genérica: es lo que permite a F3 empezar a emitir `assistant.source` —y a F4
sus eventos de herramientas— contra widgets ya desplegados en landings de
clientes, que nadie va a actualizar el mismo día. Un test lo cubre
explícitamente inyectando un evento inventado a mitad del stream.

**Persistencia de la sesión.** `localStorage`, con clave
`tess:session:<projectId>`. Se elige sobre `sessionStorage` a conciencia: un
visitante que vuelve mañana conserva su `auth.uid()`, su historial y su lead,
que es justo el comportamiento que quiere un asistente de captación.

El coste es que el refresh token vive en `localStorage`, igual que hace
`supabase-js` por defecto, y eso es vulnerable a XSS. El README del paquete
debe decirlo sin rodeos y enumerar lo que se espera de quien lo integra:

- No cargar el widget en páginas que ejecutan scripts de terceros no
  confiables.
- Definir una Content Security Policy en la landing.
- No guardar ningún otro secreto bajo el prefijo `tess:`.
- Sesión efímera en memoria si `localStorage` está bloqueado.

El cliente expone `clearSession()` para cerrar sesión y descartar los tokens.
Una integración de mayor riesgo —un panel con datos sensibles— debería pasar su
propio `getToken` y gestionar la sesión con cookies seguras del host; el
`localStorage` es la elección correcta para una landing pública, no para todo.

Los accesos a `localStorage` van envueltos en `try/catch`: en navegación
privada o con almacenamiento bloqueado lanzan, y el widget debe seguir
funcionando con una sesión en memoria.

Refresco: si el `accessToken` está a menos de 60 segundos de expirar, se renueva
antes de la petición. Un 401 inesperado reintenta una vez tras refrescar; si
vuelve a fallar, se descarta la sesión y se acuña una nueva.

## `tess-web-component`

### Atributos nuevos

`project-id` y `public-key` se suman a `OBSERVED` en `element.ts:25`. El
primero cierra el cabo suelto de F1.

Cuando `api-url`, `project-id` y `public-key` están los tres presentes, el
componente construye su cliente. `setClient()` sigue teniendo prioridad: si el
integrador inyecta el suyo, el componente no construye nada.

### La UI de chat

El diálogo deja de abrirse vacío:

```text
<dialog part="dialog">
  ├─ header    título + botón cerrar
  ├─ ol        lista de mensajes, part="messages"
  ├─ (card)    formulario de lead, condicional
  └─ form      textarea + botón enviar, part="composer"
```

`greet()` del handle de Rive se dispara al abrir, como en F1.

**Accesibilidad del streaming, que es donde esto suele salir mal.** Una región
`aria-live` que muta en cada delta hace que el lector de pantalla recite la
respuesta letra a letra. La regla:

- La burbuja en curso se pinta **fuera** de la región viva, con
  `aria-busy="true"`.
- Al recibir `assistant.completed`, el mensaje se mueve a la lista
  `role="log" aria-live="polite"` ya completo, y se anuncia una vez.
- El estado de Tess se anuncia por separado en una región viva mínima
  («pensando», «respondiendo»), traducida por `locale`.

El visitante ve el texto aparecer en vivo; quien usa lector de pantalla recibe
un anuncio de estado y luego la respuesta entera. Ninguno de los dos recibe
ruido.

### Formulario de lead

El formulario es para **prospectos**, no para cualquiera que tenga un JWT. La
condición, evaluada tras completarse la primera respuesta del asistente:

```ts
const esProspecto = !viewer.isProjectMember || viewer.collectLeadsFromMembers;
const mostrar = esProspecto && viewer.lead === null && !descartadoLocalmente;
```

Esto cubre los cuatro casos de forma correcta:

| Quién                                  | Ve el formulario                |
| -------------------------------------- | ------------------------------- |
| Visitante anónimo de una landing       | sí                              |
| Usuario registrado que no es miembro   | sí — sigue siendo un prospecto  |
| Miembro del proyecto o la organización | no, salvo configuración expresa |
| Administrador interno                  | no, salvo configuración expresa |

Nombre y correo, ambos opcionales por separado pero al menos uno obligatorio.
Junto a los campos, una línea breve de privacidad con enlace a la política; al
enviar se sella `consent_at`. Descartable, y el descarte se recuerda en
`localStorage`.

La existencia del lead se comprueba **contra el servidor**, no contra
`localStorage`, por el camino del host autenticado: ahí la identidad viaja en
el JWT, así que alguien que ya dejó sus datos desde otro dispositivo no debe
volver a ver el formulario. `localStorage` solo recuerda el descarte, que sí es
una preferencia local.

En F2 lo dispara el widget, **no el modelo**. Que Tess decida
conversacionalmente cuándo pedir los datos es tool-calling, y eso es F4. El
prompt base refuerza la separación: le dice al modelo que no pida datos
personales en el texto de la respuesta cuando el widget tiene su formulario.

### Eventos nuevos

`tess:message` con `{ role, content }` y `tess:lead` con `{ leadId }`. Se suman
a los cuatro de F1, que no cambian.

## Demo

`apps/demo-svelte` gana una segunda pestaña junto al panel de pruebas de F1:
una conversación real contra el API local, con el log de eventos mostrando la
secuencia SSE cruda. El panel de F1 se conserva intacto — sigue siendo la
superficie de validación visual de la fase anterior.

Se añade un `seed.sql` con una organización, un proyecto con
`visitor_access = true`, su `public_key` y `http://localhost:5173` en
`allowed_origins`.

## Testing

| Paquete              | Entorno                  | Qué se prueba                                                                                     |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `services/api`       | node + `app.inject()`    | secuencia SSE completa con el provider fake, catálogo de errores, validación de origen y de clave |
| `services/api`       | node + Supabase local    | RLS: cruce de tenants, visitante contra documentos, visitante contra conversación ajena           |
| `tess-client`        | node + `fetch` mockeado  | parser SSE (tramas partidas, multilínea, heartbeat), refresco de token, abort, storage que lanza  |
| `tess-web-component` | jsdom + cliente mockeado | render de mensajes, burbuja en curso fuera de la región viva, formulario de lead, eventos nuevos  |

Los tests de RLS son los que de verdad importan de esta fase y no se pueden
sustituir por tests de la API: comprueban la barrera, no el filtro. Corren
contra `supabase start` local, con tres usuarios sembrados —un miembro de A, un
miembro de B y un anónimo— y cada uno intenta explícitamente lo que no debe
poder.

Añadidos al catálogo de `pnpm-workspace.yaml`: `@fastify/rate-limit`, `ai`,
`@ai-sdk/gateway`.

## Gate de salida

**Automático.** `pnpm gate:f2` —build, test, typecheck, lint y
`check-bundle.mjs`— en verde. El bundle del web component sigue sin Svelte, sin
zod, sin URLs de backend y sin secretos. Los tests de RLS pasan contra Supabase
local.

**Seguridad e identidad.**

- Origen no permitido → 403, y **no se crea usuario**: se comprueba contando
  filas en `auth.users` antes y después.
- `publicKey` inválida → 404.
- Proyecto con `visitor_access = false` → 404.
- Un usuario de la organización A no lee conversaciones de la B.
- Un visitante no lee documentos.
- El lead de un usuario no es legible por otro.
- Un miembro ve lo que RLS le permite y nada más.

**SSE.**

- Secuencia `thinking → speaking → delta* → completed`.
- Error **antes** del primer delta: llega `assistant.error` y no se persiste
  mensaje del asistente.
- Error **después** de varios deltas: llega `assistant.error` y se persiste lo
  producido con `metadata.incomplete = true`.
- El heartbeat se emite.
- Cliente desconectado → el provider fake recibe la señal de abort y **deja de
  producir deltas**. Se verifica sobre el propio fake, no solo sobre el socket.
- Un `event:` desconocido a mitad del stream no rompe el parser.

**Idioma y comportamiento.**

- Mensaje en inglés con `locale = es-MX` → respuesta en inglés.
- Mensaje ambiguo → se usa el `locale`.
- No revela el system prompt cuando se le pide.
- Admite falta de evidencia en lugar de inventar.
- No afirma haber ejecutado acciones que no ejecutó.

**Leads.**

- Prospecto sin lead → ve el formulario tras la primera respuesta completa.
- Prospecto con lead → no lo vuelve a ver.
- Miembro del proyecto → no lo ve, salvo `collect_leads_from_members = true`.
- Upsert parcial → conserva el campo que no se reenvió.
- Ni `email` ni `fullName` → 400.

**Manual, en la demo.**

- Conversación contra el API local con el provider fake, deltas apareciendo
  progresivamente y el avatar recorriendo `thinking → speaking → success →
idle`.
- Recargar la página recupera la conversación, la sesión y el lead.
- Todo el chat recorrible solo con teclado, con la respuesta anunciada una vez
  al completarse y no delta a delta.
- Smoke test aparte con `MODEL_PROVIDER=gateway` y `AI_GATEWAY_API_KEY`
  presente: una conversación real contra el modelo.

### Preflight bloqueante

Dos comprobaciones deben resolverse **antes** de escribir la autenticación,
porque una respuesta negativa cambia la primera tarea del plan:

1. **Tipo de clave JWT del proyecto** (`Settings → API → JWT Keys` en el panel
   de Supabase). Si es asimétrica —ES256, RS256— se implementa `getClaims()`
   como dice el spec. Si sigue en el secreto HS256 heredado, la primera tarea
   es migrar a claves asimétricas y revalidar tokens nuevos, refresh, usuarios
   anónimos, miembros, expiración y revocación. **No se cae a `getUser()` en
   silencio**; solo sería aceptable como medida temporal, documentada y
   decidida a conciencia.
2. **Variables presentes** en el `.env` local: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MODEL_PROVIDER`,
   `MODEL_NAME` y, para el smoke test, `AI_GATEWAY_API_KEY`. Ninguna de ellas
   puede aparecer en el bundle del web component, en variables `PUBLIC_` de
   Vercel, en logs ni en Sentry.

## Fuera de alcance

F2 no hace RAG: ninguna respuesta cita documentos y `assistant.source` no se
emite. No hay herramientas ni MCP, así que Tess no puede crear cuentas todavía
—eso es F4, y lo que F2 entrega es el terreno para que sea posible sin migrar
datos—. No hay Docker ni Cloud Run: el API corre en local. No hay panel admin
para gestionar `project_widget_settings`; la clave pública se siembra por SQL.
Sentry queda como está desde el scaffold, sin releases ni source maps.

`rag/` y `connectors/` conservan sus `TODO`. Esto es lo que mantiene la fase
acotada y su gate verificable sin infraestructura desplegada.
