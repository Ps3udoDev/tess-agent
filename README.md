# Tess

Monorepo del asistente visual de Teams4Soft.

> Un repositorio para compartir código y contratos; varios artefactos para
> distribuir; servicios separados para ejecutar con seguridad.

La arquitectura completa está en
[`docs/plan-arquitectura-tess-typescript-supabase.md`](docs/plan-arquitectura-tess-typescript-supabase.md).
El estado actual del scaffold y los siguientes pasos, en [`SCAFFOLD.md`](SCAFFOLD.md).

## Requisitos

| Herramienta  | Versión    | Para qué                                    |
| ------------ | ---------- | ------------------------------------------- |
| Node.js      | >= 22      | Todo el monorepo                            |
| pnpm         | 11.15.0    | Workspaces y catálogo de versiones          |
| Supabase CLI | >= 2.117   | Migraciones y desarrollo local              |
| Docker       | cualquiera | Solo para `supabase start` (Supabase local) |
| gcloud CLI   | cualquiera | Solo para desplegar en Cloud Run (Fase 5)   |

## Arranque

```bash
pnpm install
cp .env.example .env     # y rellena los valores
pnpm build
```

## Estructura

```text
apps/
  demo-svelte/       Demo pública del Web Component        -> Vercel
  docs/              Documentación del SDK                 -> Vercel
  admin/             Panel administrativo multi-tenant     -> Vercel
packages/
  tess-types/        Tipos y esquemas compartidos
  tess-core/         Estados y eventos, sin framework
  tess-rive/         Carga y control de teams4soft-tess.riv
  tess-web-component/ Elemento <teams4soft-assistant>      -> npm + CDN
  tess-svelte/       Wrapper Svelte                        -> npm
  tess-react/        Wrapper React opcional                -> npm
  tess-client/       Cliente HTTP/SSE del backend
  config-eslint/     Config ESLint compartida
  config-tsconfig/   Config TypeScript compartida
services/
  api/               API Fastify                           -> Cloud Run
  ingest-worker/     Ingestión, extracción y embeddings    -> Cloud Run
  connector-worker/  Sincronización con MSP                -> Cloud Run
  mcp-gateway/       Herramientas MCP                      -> Cloud Run
supabase/
  migrations/        Esquema, RLS y funciones de RAG
  seed.sql           Datos de desarrollo local
tess-rive/           Proyecto del editor Rive (fuente de diseño)
```

## Comandos

```bash
pnpm dev                 # turbo dev en todos los workspaces
pnpm build               # build de todo el grafo
pnpm lint                # eslint
pnpm typecheck           # tsc / svelte-check
pnpm test                # vitest
pnpm format              # prettier --write

# Un solo workspace
pnpm --filter @teams4soft/demo-svelte dev
pnpm --filter @teams4soft/api dev

# Supabase
pnpm supabase:start      # requiere Docker
pnpm supabase:reset      # recrea la base local y aplica seed.sql
pnpm supabase:push       # aplica migrations/ a la base remota
pnpm supabase:types      # regenera los tipos en packages/tess-types/src/generated
```

## Reglas no negociables

1. **`SUPABASE_SERVICE_ROLE_KEY`, `MODEL_API_KEY`, `MCP_CLIENT_SECRET` y
   `CONNECTOR_ENCRYPTION_KEY` solo existen en el servidor.** Nunca en `apps/*`,
   nunca en `packages/*`, nunca en el navegador. El navegador recibe únicamente
   una URL pública de API y un token de sesión limitado.
2. **RLS es la barrera, no el filtro del desarrollador.** Toda consulta
   multi-tenant filtra por `organization_id` y `project_id`, y además las
   políticas de `supabase/migrations/0006_rls.sql` impiden que una consulta
   devuelva filas de otro tenant.
3. **A Sentry no viajan prompts, conversaciones ni contenido documental.** Solo
   IDs internos, operación, latencia, región y código de error.
4. **Los paquetes de `packages/` no leen variables de entorno.** Reciben su
   configuración por parámetro. La regla está forzada por ESLint.
