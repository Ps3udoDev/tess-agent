# Estado del scaffold

Documento de trabajo. Registra qué está montado, qué decisiones se tomaron y
qué falta. Se actualiza en cada sesión.

**Última actualización:** 2026-09-19
**Fase del roadmap:** 0 — preparación (antes de Fase 1, componente visual)

---

## 1. Qué está montado

### Raíz

| Archivo                    | Rol                                                                     |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm-workspace.yaml`      | Workspaces + **catálogo** de versiones (`catalog:`) + builds permitidos |
| `turbo.json`               | Tareas `build/dev/test/lint/typecheck/clean` y su grafo                 |
| `tsconfig.json`            | Solo editor; extiende `@teams4soft/config-tsconfig/base.json`           |
| `eslint.config.js`         | Solo archivos sueltos de la raíz                                        |
| `.env.example`             | Plantilla completa de variables, con la frontera público/servidor       |
| `.dockerignore`            | Contexto de build de los cuatro servicios (la raíz del monorepo)        |
| `.github/workflows/ci.yml` | lint · typecheck · test · build + validación de migraciones             |

### 16 workspaces

```text
apps/       demo-svelte   docs   admin
packages/   tess-types  tess-core  tess-rive  tess-web-component
            tess-svelte  tess-react  tess-client
            config-eslint  config-tsconfig
services/   api   ingest-worker   connector-worker   mcp-gateway
```

Cada uno con `package.json`, `tsconfig.json`, `eslint.config.js` y su build
(`tsup` para librerías y servicios, `vite`/SvelteKit para apps). Los cuatro
servicios traen `Dockerfile` multi-stage listo para Cloud Run.

### Supabase

```text
supabase/config.toml                 major_version = 17 (coincide con el remoto)
supabase/migrations/0001_extensions.sql     pgcrypto + pgvector en `extensions`
supabase/migrations/0002_tenancy.sql        organizations, organization_members,
                                            projects, project_members
supabase/migrations/0003_documents.sql      documents, document_sections,
                                            document_embeddings + índice HNSW
supabase/migrations/0004_conversations.sql  conversations, messages
supabase/migrations/0005_config_audit.sql   assistant_configs,
                                            connector_credentials, audit_events
supabase/migrations/0006_rls.sql            RLS en las 12 tablas + helpers
supabase/migrations/0007_rag_fn.sql         match_document_sections()
supabase/seed.sql                           datos de desarrollo local
```

### Sentry

| Proyecto        | Plataforma       | Dónde vive la config                                                                                                             |
| --------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tess-frontend` | Svelte/SvelteKit | `apps/demo-svelte` y `apps/admin`: `hooks.client.ts`, `instrumentation.server.ts`, `hooks.server.ts`, plugin en `vite.config.ts` |
| `tess-api`      | Node.js          | `services/api/src/instrument.ts` y el mismo archivo en los tres workers                                                          |

`apps/docs` no lleva Sentry (es estática y no toca datos).

---

## 2. Decisiones que se apartan del plan, y por qué

1. **TypeScript 6.0.3, no 7.**
   `typescript@latest` es 7.0.2, pero `typescript-eslint@8.70` declara
   `typescript >=4.8.4 <6.1.0` y `@sveltejs/kit@2.70` declara `^5.3.3 || ^6.0.0`.
   6.0.3 es la última estable que satisface a ambos.

2. **Existe `organization_members`, que no está en el modelo mínimo del plan.**
   Sin una tabla de pertenencia, RLS sobre `organizations` no puede resolver
   quién ve qué. El plan lista `project_members` pero no su equivalente a nivel
   de organización.

3. **La columna tenant se llama `organization_id`, no `tenant_id`.**
   Es una FK real a `organizations(id)`. El plan usa `tenant_id` como concepto;
   aquí el concepto y la clave foránea son la misma columna.

4. **Catálogo de versiones de pnpm (`catalog:`).**
   Con 16 workspaces, subir Svelte o TypeScript en un solo lugar evita
   divergencias silenciosas entre paquetes.

5. **`tess-svelte` y `tess-react` se construyen con `tsup`, no con
   `@sveltejs/package`.**
   Todavía no existen archivos `.svelte` ni `.tsx`. Cuando lleguen en Fase 1,
   `tess-svelte` debe migrar a `@sveltejs/package`.

6. **Los documentos de planificación se movieron a `docs/`.**
   `plan-arquitectura-*.md`, `mascota-virtual-teams4soft.md`, `prompts-rive.md`
   y las dos imágenes. `tess-rive/` sigue en la raíz porque es el proyecto del
   editor Rive y su `rive.yaml` usa rutas relativas.

---

## 3. Contrato del avatar

Extraído de `tess-rive/scene.rml` y fijado en
`packages/tess-rive/src/contract.ts`. Si cambia en el editor de Rive, los dos
archivos se actualizan juntos.

```text
Artboard       Tess (500x500)
State machine  TessStateMachine
Triggers       trigger_greet   trigger_success   trigger_error
Booleanos      is_listening    is_thinking       is_speaking
               prefers_reduced_motion
Animaciones    anim_idle  anim_greeting  anim_listening  anim_thinking
               anim_speaking  anim_success  anim_error  anim_reduced_motion
```

`packages/tess-rive/assets/teams4soft-tess.riv` es una copia de
`tess-rive/build/tess.riv` (22 KB). Se resincroniza con:

```bash
pnpm --filter @teams4soft/tess-rive sync:riv
```

La traducción estado semántico → input de Rive vive en `@teams4soft/tess-core`
y todavía no está implementada.

---

## 4. Verificación ejecutada

| Comando            | Resultado                             |
| ------------------ | ------------------------------------- |
| `pnpm install`     | 511 paquetes, sin conflictos de peers |
| `pnpm build`       | 14/14 tareas ✅                       |
| `pnpm typecheck`   | 20/20 tareas ✅                       |
| `pnpm lint`        | 20/20 tareas ✅                       |
| `pnpm format`      | ✅                                    |
| `supabase link`    | ✅ `mpntdrcsdspuyfltvexs` (tess)      |
| `supabase db push` | ✅ 7/7 migraciones aplicadas          |

---

## 5. Pendiente inmediato

- [x] `supabase link --project-ref mpntdrcsdspuyfltvexs`
- [x] `supabase db push` — las 7 migraciones aplicadas en el proyecto remoto
- [ ] Verificar el esquema con `supabase migration list --linked` y `supabase db lint --linked`
- [ ] `pnpm supabase:types` para generar los tipos de la base
- [ ] Rellenar `.env` con `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Primer commit (lo hace el equipo, no la herramienta)

### Bloqueador conocido: la credencial del CLI de Supabase alterna de cuenta

En `~/.claude.json` hay un servidor MCP de Supabase apuntando a
`project_ref=rrnysepngbycvuciodoj` (**book-now-hub**, de la org _Ps3udoDev_).
Ese MCP comparte el almacén de credenciales con el CLI, así que al refrescar su
token sobrescribe el de la org de Teams4Soft y cualquier comando `--linked`
devuelve 403.

Se observó cuatro veces en la misma sesión: Teams4Soft → Ps3udoDev →
Teams4Soft (tras login manual, momento en que link y push funcionaron) →
Ps3udoDev.

Soluciones, de más a menos robusta:

1. Definir `SUPABASE_ACCESS_TOKEN` como variable de entorno de usuario de
   Windows con un token personal de la cuenta de Teams4Soft. La variable tiene
   precedencia sobre el almacén de credenciales, así que el MCP deja de poder
   pisarla. Requiere reiniciar la terminal y Claude Code.
2. Quitar o desactivar ese servidor MCP mientras se trabaja en Tess.
3. Repetir `supabase login` antes de cada comando `--linked`. Funciona, pero
   vuelve a romperse en cuanto el MCP refresca.

## 6. Siguiente fase (Fase 1 — componente visual)

- [ ] `tess-core`: máquina de estados, bus de eventos, detección de reduced-motion
- [ ] `tess-rive`: `mountTessRive()` con `destroy()` y pausa fuera de viewport
- [ ] `tess-web-component`: `<teams4soft-assistant>` con botón accesible y
      diálogo HTML en el DOM (no en el canvas)
- [ ] `tess-svelte`: migrar a `@sveltejs/package` y añadir `Tess.svelte`
- [ ] `apps/demo-svelte`: montar el componente y validar la silueta a 48/72/96 px
- [ ] Desplegar `demo-svelte` y `docs` en Vercel con Root Directory por proyecto
