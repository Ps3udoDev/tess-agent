# Arquitectura y despliegue de Tess

## Decisión ejecutiva

Tess debe mantenerse en **un solo repositorio monorepo**, pero distribuirse como varios artefactos y desplegarse como servicios independientes. Esta separación evita mezclar el componente visual con secretos, procesos de ingestión, herramientas MCP o lógica de recuperación documental.

La recomendación para el primer producto es:

- **TypeScript** para frontend, SDK, API y workers iniciales.
- **Svelte** para la aplicación de demostración y el panel administrativo, si es el framework preferido del equipo.
- **Web Component** como superficie universal del SDK visual.
- **Rive** para el avatar `teams4soft-tess.riv`.
- **Supabase** para Postgres, Auth, Storage, `pgvector` y Row Level Security.
- **Vercel** para la aplicación de demostración, documentación, panel web y, opcionalmente, un API ligero.
- **Google Cloud Run** para el backend dedicado, la ingestión documental, los conectores y los procesos de agente que necesiten mayor control de ejecución.
- **SSE** para transmitir respuestas de texto en el MVP. WebSockets solo cuando exista una necesidad real de comunicación bidireccional persistente.
- **Sentry** para monitoreo de errores, trazas de rendimiento y asociación entre frontend, API y workers.

La idea central es la siguiente:

> **Un repositorio para compartir código y contratos; varios artefactos para distribuir; servicios separados para ejecutar con seguridad.**

## Vercel no es el lugar donde se instala el componente

El componente visual no se “instala dentro de Vercel” como si Vercel fuera su destino final. El componente se desarrolla y publica como un paquete npm o como un archivo distribuible desde un CDN.

Por ejemplo:

```bash
pnpm add @teams4soft/tess
```

La aplicación que consume el paquete puede estar alojada en Vercel, Cloudflare, Netlify, un servidor propio o cualquier hosting capaz de servir JavaScript.

Vercel puede alojar:

- La página de documentación del SDK.
- Una aplicación de demostración.
- El panel administrativo de Tess.
- Un sitio Astro o SvelteKit.
- Un proyecto Next.js.
- El bundle del componente, si se desea servirlo desde un CDN o endpoint público.
- Funciones API pequeñas y dirigidas por solicitudes.

Sin embargo, el consumidor real de Tess instala el paquete desde npm o importa un bundle desde una URL. Por eso conviene distinguir entre **publicar el paquete** y **desplegar una aplicación que lo demuestra**.

## Monorepo recomendado

La estructura inicial puede ser:

```text
tess/
├── apps/
│   ├── demo-svelte/          # Demo pública del componente
│   ├── docs/                 # Documentación del SDK
│   └── admin/                # Panel interno multi-tenant
│
├── packages/
│   ├── tess-core/            # Estados, eventos y contratos sin framework
│   ├── tess-rive/            # Carga y control de teams4soft-tess.riv
│   ├── tess-web-component/   # Elemento <teams4soft-assistant>
│   ├── tess-svelte/          # Wrapper Svelte
│   ├── tess-react/           # Wrapper React opcional
│   ├── tess-client/          # Cliente HTTP/SSE del backend
│   └── tess-types/           # Tipos y esquemas compartidos
│
├── services/
│   ├── api/                  # Backend HTTP principal
│   ├── ingest-worker/        # Ingestión, extracción y embeddings
│   ├── connector-worker/     # Sincronización con MSP y fuentes externas
│   └── mcp-gateway/          # Herramientas MCP, si se separa posteriormente
│
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── config.toml
│
├── packages/config-eslint/
├── packages/config-tsconfig/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

La carpeta `packages` contiene código reutilizable. La carpeta `apps` contiene aplicaciones concretas. La carpeta `services` contiene procesos desplegables. Todas pueden vivir en el mismo repositorio sin convertirse en el mismo servidor.

## Qué se publica y dónde

| Artefacto                        | Forma de distribución         | Destino recomendado                     |
| -------------------------------- | ----------------------------- | --------------------------------------- |
| `@teams4soft/tess-core`          | Paquete npm privado o público | npm compatible                          |
| `@teams4soft/tess-web-component` | Paquete npm y bundle ESM      | npm/CDN                                 |
| `@teams4soft/tess-svelte`        | Paquete npm                   | npm                                     |
| `teams4soft-tess.riv`            | Asset versionado              | CDN o almacenamiento público controlado |
| Demo Svelte                      | Aplicación web                | Vercel                                  |
| Documentación                    | Aplicación estática           | Vercel                                  |
| Panel administrativo             | Aplicación web                | Vercel, con autenticación               |
| API de conversación              | Servicio HTTP TypeScript      | Cloud Run o Vercel Functions            |
| Worker de ingestión              | Contenedor o job              | Cloud Run Jobs o Cloud Run              |
| Conectores MSP                   | Servicios o workers           | Cloud Run                               |
| Documentos originales            | Objetos privados              | Supabase Storage                        |
| Embeddings y metadatos           | PostgreSQL + `pgvector`       | Supabase                                |
| Errores, trazas y releases       | Sentry                        | Frontend, API y workers                 |

## Vercel frente a Cloud Run

### Vercel

Vercel es una buena opción cuando la ejecución está directamente vinculada a una solicitud HTTP. Su runtime Node.js permite crear APIs, webhooks, handlers de agentes y respuestas en streaming. También puede alojar aplicaciones SvelteKit, Astro o Next.js.

Usaría Vercel para:

- La demo de Tess.
- La documentación.
- El panel web.
- Un endpoint de chat sencillo con streaming SSE.
- Webhooks pequeños.
- Proxies o BFF que no tengan procesos largos.

Vercel puede escalar funciones automáticamente y reducirlas a cero cuando no hay tráfico. La duración, memoria, región y modelo de ejecución dependen del plan y de la configuración vigente. Por ello deben revisarse los límites antes de colocar en Vercel la ingestión documental o una tarea que pueda durar varios minutos.

### Cloud Run

Cloud Run es más apropiado para el backend dedicado porque ejecuta contenedores HTTP completos y permite controlar el servidor Node.js, el proceso de arranque, la concurrencia, los timeouts y la configuración de despliegue.

Usaría Cloud Run para:

- API principal de Tess.
- Streaming SSE de mayor duración.
- Workers y procesos de ingestión.
- Conectores MSP.
- Clientes o servidores MCP.
- Jobs de sincronización.
- Servicios que necesiten dependencias nativas o un proceso Node completo.
- Un backend que después pueda incorporar WebSockets.

Cloud Run soporta WebSockets, pero las conexiones están sujetas al timeout de la solicitud. Los clientes deben reconectarse y el estado compartido debe vivir fuera del contenedor. Una instancia con conexiones WebSocket abiertas permanece activa y genera facturación; para el MVP conviene preferir SSE cuando solo se necesita enviar texto y eventos del servidor al navegador.

### Fastify frente a Hono

Para el backend dedicado de Tess recomiendo **Fastify** como opción principal. Fastify está orientado a Node.js y ofrece validación y serialización basadas en JSON Schema, hooks, plugins y un ecosistema adecuado para una API de producción. Esto encaja con un backend que tendrá autenticación, multi-tenancy, streaming SSE, RAG, MCP, conectores, auditoría y observabilidad.

Hono también es una opción válida. Está construido alrededor de Web Standards, tiene soporte TypeScript y puede ejecutarse en Node.js mediante `@hono/node-server`, además de otros runtimes. Lo elegiría si Tess necesitara publicar la misma API en Cloudflare Workers, Vercel, Deno, Bun y Node.js, o si el servicio fuera principalmente una colección pequeña de endpoints.

La elección concreta para este proyecto es:

```text
Backend dedicado en Cloud Run:
  Fastify

Componente web y SDK:
  TypeScript + Web Components + Rive

Hono:
  Alternativa futura para un gateway pequeño y portable
```

No usaría Hono únicamente por una diferencia de microbenchmark. En Tess, el tiempo dominante será normalmente la autenticación, la recuperación vectorial, la llamada al modelo y los conectores externos. Para este alcance pesan más la validación de schemas, los plugins, la mantenibilidad y la facilidad de operación que una diferencia de throughput sintético.

Fastify debe validar las entradas y salidas mediante JSON Schema o una librería compatible. El endpoint de chat devolverá `text/event-stream`, mientras que la lógica de RAG, las herramientas y los conectores permanecerán fuera del handler HTTP.

### Sentry

Sentry debe añadirse en tres superficies:

```text
apps/demo-svelte o apps/admin:
  errores de navegador, errores de carga de Rive, errores de UI y Web Vitals

services/api:
  excepciones, latencia de rutas, errores de Supabase, RAG, modelo, MCP y conectores

services/ingest-worker y connector-worker:
  fallos de extracción, embeddings, sincronización y reintentos agotados
```

La configuración debe incluir:

- Entornos diferenciados para `development`, `staging` y `production`.
- `release` versionado con el commit o la versión del paquete desplegado.
- Source maps subidos durante el build y no expuestos públicamente.
- Captura de excepciones no controladas y rechazos no manejados.
- Trazas correlacionadas entre navegador, API y servicios externos cuando sea posible.
- `trace_id` o correlación equivalente en logs y eventos del backend.
- Scrubbing de PII, tokens, prompts completos, contenido documental y credenciales.
- Alertas para errores, p95 de latencia, fallos de ingestión y problemas por proveedor.

Sentry no sustituye los logs estructurados, las métricas ni OpenTelemetry. Su función es ayudar a identificar qué falló, en qué release y con qué traza relacionada. No se debe enviar a Sentry el texto completo de conversaciones o documentos privados. Los eventos deben contener IDs internos anonimizados, operación, latencia, región y código de error.

Ejemplo conceptual para el servidor:

```ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_RELEASE,
  tracesSampleRate: 0.1,
});
```

La tasa de trazas debe ajustarse con el volumen y coste reales. Los errores críticos pueden conservar una tasa mayor, mientras que las trazas normales pueden muestrearse.

### Recomendación concreta

Para la primera versión:

```text
Vercel:
  demo-svelte
  docs
  admin

Cloud Run:
  api
  ingest-worker
  connector-worker

Supabase:
  Auth
  Postgres
  Storage
  pgvector
  RLS

Observabilidad:
  Sentry
  OpenTelemetry
  logs estructurados
  métricas
```

Vercel y Cloud Run no son alternativas excluyentes. Es normal utilizar Vercel para la experiencia web y Cloud Run para el backend dedicado.

## Supabase como almacenamiento documental y RAG

Supabase puede cubrir inicialmente varias responsabilidades:

- Postgres para usuarios, organizaciones, proyectos y conversaciones.
- Storage para archivos originales.
- `pgvector` para embeddings y búsqueda semántica.
- Auth para usuarios y sesiones.
- Row Level Security para limitar documentos por organización y proyecto.

Modelo mínimo:

```text
organizations
projects
project_members
documents
 document_sections
 document_embeddings
 conversations
 messages
 assistant_configs
 connector_credentials
 audit_events
```

Cada documento y cada sección vectorial debe tener como mínimo:

```text
tenant_id
project_id
document_id
content
embedding
metadata
created_at
```

La consulta de similitud debe filtrar por `tenant_id` y `project_id`. La protección no debe depender solamente de un filtro escrito por el desarrollador en cada consulta. Las políticas RLS deben impedir que una consulta pueda devolver secciones de otro tenant.

El backend debe utilizar la clave de servicio de Supabase únicamente en servidor. Nunca debe incluirse en el bundle de Svelte, en el Web Component ni en el navegador.

## Backend de Tess

El backend debe organizarse por responsabilidades, no por proveedores concretos:

```text
services/api/src/
├── http/
│   ├── chat.route.ts
│   ├── documents.route.ts
│   ├── connectors.route.ts
│   └── health.route.ts
├── domain/
│   ├── conversations/
│   ├── tenants/
│   ├── permissions/
│   └── assistant-events/
├── rag/
│   ├── ingestion.ts
│   ├── retrieval.ts
│   ├── citations.ts
│   └── permissions.ts
├── agent/
│   ├── model-provider.ts
│   ├── tool-policy.ts
│   ├── mcp-client.ts
│   └── orchestration.ts
├── connectors/
│   ├── connector.ts
│   ├── registry.ts
│   └── adapters/
├── security/
├── observability/
└── main.ts
```

El proveedor del modelo, el vector store y los MSP deben estar detrás de interfaces. Así se puede cambiar de proveedor sin reescribir la lógica de negocio.

## API mínima

### Solicitar respuesta del asistente

```http
POST /v1/projects/{projectId}/conversations/{conversationId}/messages
Content-Type: application/json
Authorization: Bearer <session-token>
```

```json
{
  "content": "¿Qué servicios de migración ofrecen?",
  "locale": "es-MX"
}
```

La respuesta puede utilizar `text/event-stream`:

```text
event: assistant.state
data: {"state":"thinking"}

event: assistant.delta
data: {"text":"Teams4Soft ofrece"}

event: assistant.source
data: {"title":"Servicios de migración"}

event: assistant.completed
data: {"messageId":"msg_123"}
```

El frontend traduce los estados del backend a los inputs de Rive:

```text
thinking  -> Tess piensa
speaking  -> Tess responde
completed -> Tess vuelve a idle
error     -> Tess muestra error
```

## Configuración mínima del proyecto

### Requisitos

```text
Node.js 22 LTS o la versión LTS aprobada por el equipo
pnpm 9 o posterior
Docker
Supabase CLI
Google Cloud CLI si se utiliza Cloud Run
Git
```

### Crear workspace

```bash
mkdir tess
cd tess
git init
pnpm init
pnpm add -D turbo typescript eslint prettier vitest
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - services/*
```

Scripts mínimos del `package.json` raíz:

```json
{
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "format": "prettier --write .",
    "supabase:start": "supabase start",
    "supabase:reset": "supabase db reset"
  }
}
```

### Variables de entorno

Nunca deben enviarse al paquete visual:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MODEL_API_KEY=
MCP_CLIENT_SECRET=
CONNECTOR_ENCRYPTION_KEY=
SENTRY_DSN=
```

El navegador solo debe recibir una URL pública de API y un token de sesión limitado. `SUPABASE_SERVICE_ROLE_KEY`, claves de modelos y credenciales MSP solo deben existir en Cloud Run o en el sistema de secretos del proveedor de despliegue.

## Primer despliegue recomendado

### Vercel

Crear un proyecto Vercel para `apps/demo-svelte` y otro para `apps/docs`. En cada proyecto se configura el `Root Directory` correspondiente dentro del monorepo. Vercel permite conectar varios proyectos a un mismo repositorio y desplegar cada directorio como un proyecto independiente.

### Cloud Run

Crear un Dockerfile para `services/api`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY services/api ./services/api
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @teams4soft/api build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/main.js"]
```

El servidor debe escuchar en:

```text
0.0.0.0:${PORT}
```

Despliegue conceptual:

```bash
gcloud run deploy tess-api \
  --source services/api \
  --region us-central1 \
  --allow-unauthenticated
```

En producción, la autenticación debe hacerse en la aplicación y mediante el proveedor de identidad elegido. No se debe interpretar `allow-unauthenticated` como permiso para omitir autorización; significa que el endpoint puede recibir solicitudes y luego debe validar la sesión, el tenant y los permisos.

## ¿Una aplicación única o dos proyectos?

La mejor respuesta es:

> **Un monorepo, dos superficies principales y varios despliegues.**

No recomiendo separar los repositorios al inicio porque:

- Se duplicarían tipos.
- Se complicaría el versionado del contrato entre UI y backend.
- Sería más difícil probar cambios coordinados.
- Se perdería velocidad durante el MVP.

Tampoco recomiendo ejecutar UI, API, workers y panel como un único proceso porque:

- Un fallo del worker podría afectar al chat.
- Los secretos quedarían cerca del código cliente.
- El escalado sería menos eficiente.
- Las tareas de ingestión no tendrían un ciclo de vida independiente.
- El despliegue de una pequeña modificación visual podría reiniciar todo el sistema.

La separación propuesta es:

```text
Monorepo único
    ├── Paquetes reutilizables
    ├── Aplicaciones web
    ├── API dedicada
    └── Workers

Despliegues independientes
    ├── Vercel: demo/docs/admin
    └── Cloud Run: api/workers/connectors
```

## Roadmap mínimo

### Fase 1: componente visual

Crear `tess-core`, `tess-rive`, `tess-web-component` y `tess-svelte`. Cargar el `.riv`, exponer `state`, `theme`, `size`, `openChat` y `destroy`, y documentar un demo en Vercel.

### Fase 2: backend de chat

Crear `services/api` con autenticación, conversaciones, mensajes y endpoint SSE. Conectar Supabase y devolver respuestas simuladas antes de conectar RAG.

### Fase 3: RAG

Añadir Storage, extracción de texto, chunking, embeddings, `pgvector`, filtros por tenant y citas. Ejecutar la ingestión fuera de la solicitud interactiva.

### Fase 4: agente y conectores

Añadir herramientas allowlisted, MCP, adaptadores MSP, timeouts, auditoría, rate limits y pruebas de permisos.

### Fase 5: operación

Añadir Docker, Cloud Run, CI/CD, Sentry, OpenTelemetry, logs estructurados, métricas de p50/p95, pruebas de carga, threat model y documentación de integración. Configurar releases, source maps y scrubbing de PII antes de activar producción.

## Recomendación final

Comenzaría con un **monorepo TypeScript + pnpm + Turborepo**. Publicaría `@teams4soft/tess-web-component` y `@teams4soft/tess-svelte` como paquetes. Alojaría la demo y documentación en Vercel. Ejecutaría la API y los workers en Cloud Run con **Fastify**. Utilizaría Supabase como sistema gestionado de autenticación, almacenamiento, PostgreSQL, `pgvector` y políticas RLS. Añadiría Sentry desde el primer despliegue funcional para asociar errores de UI, API y workers con releases y trazas.

Esta combinación permite que Tess sea simultáneamente:

- Una dependencia instalable.
- Un Web Component independiente del framework.
- Un wrapper Svelte.
- Un servicio backend dedicado.
- Una plataforma RAG multi-tenant.
- Un sistema extensible mediante MCP y conectores.

## Referencias

[1]: https://vercel.com/docs/functions 'Vercel Functions'
[2]: https://vercel.com/docs/monorepos 'Vercel Monorepos'
[3]: https://docs.cloud.google.com/run/docs/triggering/websockets 'Cloud Run WebSockets and streaming'
[4]: https://supabase.com/docs/guides/ai/rag-with-permissions 'Supabase RAG with permissions'
[5]: https://supabase.com/docs/guides/functions/limits 'Supabase Edge Functions limits'
[6]: https://rive.app/docs/runtimes/web/web-js 'Rive Web JavaScript runtime'
[7]: https://docs.sentry.io/platforms/javascript/guides/node/ 'Sentry for Node.js'
[8]: https://docs.sentry.io/platforms/javascript/guides/sveltekit/ 'Sentry for SvelteKit'
[9]: https://docs.sentry.io/platforms/javascript/sourcemaps/ 'Sentry JavaScript source maps'
[10]: https://hono.dev/docs/ 'Hono documentation'
[11]: https://fastify.dev/docs/latest/Reference/TypeScript/ 'Fastify TypeScript documentation'
[12]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ 'Fastify validation and serialization'
