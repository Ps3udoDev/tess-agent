# Roadmap de Tess

**Última actualización:** 2026-09-19
**Naturaleza:** documento vivo. Se actualiza al cerrar cada fase, no al planificarla.

## Para qué sirve este documento

Tess se construye en cinco fases. Lo que impide que una fase interfiera con la
siguiente no es el orden en que se ejecutan: son las fronteras. Cada fase
congela un contrato que las posteriores consumen sin renegociar.

Este documento es el índice de esas fronteras. Responde tres preguntas:

- qué fases hay y qué entrega cada una,
- qué contrato congela cada fase y quién lo consume después,
- cuáles están cerradas, cuál está en curso y cuáles no se han tocado.

El detalle de diseño de cada fase vive en su spec, bajo
`docs/superpowers/specs/`. El detalle de ejecución, en su plan, bajo
`docs/superpowers/plans/`. Aquí solo está el mapa.

El contexto que precede a todas las fases está en
`docs/plan-arquitectura-tess-typescript-supabase.md` (decisiones de
infraestructura) y `docs/mascota-virtual-teams4soft.md` (decisiones de producto
y personaje).

## Estado

| Fase | Nombre                      | Estado                                  | Spec                                                  | Plan                                           |
| ---- | --------------------------- | --------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| F1   | Componente visual           | ✅ **Cerrada** — PR #1, merge `ec128d5` | `specs/2026-09-19-fase-1-componente-visual-design.md` | `plans/2026-09-19-fase-1-componente-visual.md` |
| F2   | Backend de chat e identidad | ✅ **Cerrada** — PR #N, merge `<sha>`   | `specs/2026-09-19-fase-2-backend-chat-design.md`      | `plans/2026-09-19-fase-2-backend-chat.md`      |
| F3   | RAG                         | ⬜ No iniciada                          | —                                                     | —                                              |
| F4   | Agente, MCP y conectores    | ⬜ No iniciada                          | —                                                     | —                                              |
| F5   | Operación                   | ⬜ No iniciada                          | —                                                     | —                                              |

## Mapa de contratos

Un contrato congelado no se renegocia. Puede **ensancharse de forma aditiva**
—añadir un campo opcional, un método opcional, un endpoint nuevo— pero no
cambiar de forma ni de significado.

| Contrato                                          | Se congela en | Lo consume                            | Dónde vive                                     |
| ------------------------------------------------- | ------------- | ------------------------------------- | ---------------------------------------------- |
| `AssistantState` — 7 estados                      | **F1** ✅     | F2 vía SSE, F4                        | `packages/tess-types/src/assistant.ts`         |
| Atributos, métodos y eventos del web component    | **F1** ✅     | todas                                 | `packages/tess-web-component/src/element.ts`   |
| `AssistantStreamEvent` — 5 eventos                | **F1** ✅     | F2 lo produce, F3 emite `source`      | `packages/tess-types/src/events.ts`            |
| Contrato del `.riv` — 3 triggers, 4 booleanos     | **F1** ✅     | solo `tess-rive`                      | `packages/tess-rive/src/contract.ts`           |
| Esquema Supabase base — 12 tablas + RLS           | pre-F1 ✅     | F2, F3, F4                            | `supabase/migrations/0001`–`0007`              |
| `TessClientLike` — cliente HTTP/SSE               | **F2** ✅     | F3, F4                                | `packages/tess-types/src/client.ts`            |
| Modelo de identidad — visitante, usuario, miembro | **F2** ✅     | F3, F4, F5                            | `supabase/migrations/0008`–`0010`              |
| Esquemas zod de la API                            | **F2** ✅     | F3, F4                                | `packages/tess-types/src/api.ts`               |
| `ModelProvider` — interfaz de streaming           | **F2** ✅     | F3 le añade contexto, F4 herramientas | `services/api/src/agent/model-provider.ts`     |
| Secuencia de eventos SSE                          | **F2** ✅     | F3, F4                                | `packages/tess-types/src/events.ts`            |
| Forma de las citas — `messages.sources`           | **F3**        | F4, panel admin                       | `supabase/migrations/0004` (columna ya existe) |
| Allowlist de herramientas MCP                     | **F4**        | F5                                    | `assistant_configs.enabled_tools` (ya existe)  |
| Formato de `audit_events.metadata`                | **F4**        | F5                                    | `supabase/migrations/0005` (tabla ya existe)   |

### Contratos que el esquema ya reserva

Tres columnas del esquema base existen desde antes de F1 y **nadie las escribe
todavía**. No son deuda: son fronteras reservadas.

- `messages.sources` — citas de RAG. La puebla F3.
- `assistant_configs.enabled_tools` — allowlist de herramientas. La puebla F4.
- `audit_events` — auditoría. La escribe F2 de forma mínima y F4 en serio.

---

## F1 · Componente visual ✅

**Objetivo.** Que Tess exista como avatar instalable, independiente de
framework, sin tocar la red.

**Entregado.**

- `@teams4soft/tess-core` — store observable, única fuente de verdad del
  estado. Transitorios con cancelación, `offline` como override derivado y
  `reduced-motion` como señal paralela.
- `@teams4soft/tess-rive` — traduce `AssistantState` a inputs de
  `TessStateMachine`. Pausa fuera de viewport, resize HiDPI, `destroy()`
  completo.
- `@teams4soft/tess-web-component` — `<teams4soft-assistant>` con launcher
  accesible, diálogo **no modal**, Shadow DOM abierto y `part=`.
- `@teams4soft/tess-svelte` — wrapper vía `@sveltejs/package`.
- `apps/demo-svelte` — panel de pruebas con los siete estados, apariencia y log
  de eventos.
- `pnpm gate:f1` y `scripts/check-bundle.mjs`.

**Congela.** `AssistantState`, la API pública del web component,
`AssistantStreamEvent`, el contrato del `.riv` y el punto de inyección del
cliente (`TessClientLike` + `setClient()`).

**Gate.** Cumplido. Build, test, typecheck y lint en verde; `tess.global.js`
sin Svelte, sin URLs de backend y sin secretos; los siete estados validados a
ojo sobre el avatar real; launcher y diálogo recorribles solo con teclado.

**Deuda que hereda F2.**

1. `element.ts:25` — `OBSERVED` no incluye `project-id`, aunque
   `TessAssistantConfig.projectId` ya existe en los tipos y la ruta del API es
   `/v1/projects/{projectId}/…`.
2. El diálogo se abre vacío a propósito. La UI de chat era explícitamente
   alcance de F2.
3. El plan de F1 quedó con 0/75 casillas marcadas pese a estar mergeado. Esta
   tabla es ahora el registro de verdad del estado de la fase.

---

## F2 · Backend de chat e identidad ✅

**Objetivo.** Que Tess conteste. Un visitante sin cuenta abre la landing,
pregunta, recibe texto en streaming y —si quiere— deja nombre y correo.

**Entrega.**

- `services/api` en Fastify: autenticación, resolución de tenant,
  conversaciones, mensajes y el endpoint SSE.
- Sesiones de visitante mediante **Supabase Anonymous Sign-In acuñado por el
  API**, con validación de `Origin`, clave pública y rate limit antes de
  acuñar.
- Migraciones `0008` (ajustes del widget + `leads`), `0009` (RLS de
  visitante) y `0010` (integridad de tenant en triggers).
- `ModelProvider` con dos implementaciones: `fake` determinista para CI y
  `gateway` real vía Vercel AI Gateway.
- Prompt base sembrado por SQL, con las reglas de seguridad por delante de la
  configuración del proyecto, y respuesta en el idioma del mensaje.
- `@teams4soft/tess-client` implementado de verdad.
- La UI de chat dentro del web component, con `aria-live` bien puesto, y
  captura de leads solo a prospectos.

**Congela.** El modelo de identidad de tres roles, `TessClientLike` ensanchado,
los esquemas zod de la API, la interfaz `ModelProvider` y la secuencia exacta
de eventos SSE.

**Gate.** Cumplido (`pnpm gate:f2`). Build, test, typecheck y lint en verde;
`tess.global.js` limpio (212.6 kB) sin zod ni secretos; sesiones de visitante
acuñadas con validación de origen (403 a orígenes no permitidos); streaming SSE
con ciclo `thinking → speaking → delta* → completed`; RLS verificado para los
tres roles; demo Svelte conversando contra el API local.

**Deuda que hereda F3.**

1. El rate limiter sigue siendo en memoria (`MemoryRateLimiter`) y hay que
   sustituirlo por una implementación respaldada por Redis o similar antes de
   producción para escalado horizontal.
2. No hay panel admin para gestionar `project_widget_settings` ni rotación de
   claves públicas; actualmente las claves se siembran por SQL / migraciones.
3. El `ModelGatewayProvider` requiere que `AI_GATEWAY_API_KEY` esté configurado
   en producción para usar modelos reales de Vercel AI Gateway; en local/CI se
   usa el provider determinista `fake`.

**Decisión de alcance.** El roadmap original preveía para F2 solo «respuestas
simuladas». Se amplió a identidad de visitante y captura de leads porque el
producto vive en landings públicas, donde el interlocutor no tiene cuenta. Esa
ampliación es lo que permitirá a F4 ofrecer «Tess te crea la cuenta» sin
reconciliar datos después.

---

## F3 · RAG ⬜

**Objetivo.** Que Tess conteste **con la documentación del proyecto** y cite de
dónde lo sacó.

**Entrega prevista.**

- Supabase Storage para los archivos originales, con bucket privado por
  organización.
- `services/ingest-worker`: extracción de texto, chunking, embeddings vía AI
  Gateway y escritura en `document_sections` y `document_embeddings`. **Fuera
  de la petición interactiva**, nunca dentro del handler HTTP.
- Recuperación vía `match_document_sections()`, que ya existe en
  `0007_rag_fn.sql` y es `security invoker`: RLS aplica dentro de la función.
- `assistant.source` empieza a emitirse. El evento ya está tipado desde F1; F3
  solo pasa a producirlo.
- `messages.sources` empieza a poblarse.

**Congela.** La forma de la cita y la estrategia de chunking.

**Gate.** Se sube un PDF, el worker lo procesa, y una pregunta devuelve
respuesta con `assistant.source` apuntando al documento correcto. La búsqueda
vectorial nunca cruza tenants, demostrado con un test que lo intenta.

**Decisiones aplazadas a su spec.** Tamaño y solape del chunk; si el visitante
anónimo puede consultar documentos o solo el miembro autenticado; reindexado al
cambiar de modelo de embeddings; si la ingestión se dispara por webhook de
Storage o por cola.

---

## F4 · Agente, MCP y conectores ⬜

**Objetivo.** Que Tess **haga cosas**, no solo conteste. Incluye el caso que
motivó el modelo de identidad de F2: crear la cuenta del visitante cuando lo
pide.

**Entrega prevista.**

- Herramientas con allowlist por proyecto, leída de
  `assistant_configs.enabled_tools`. Vacío significa que el agente no puede
  invocar nada — ese es ya el default en el esquema.
- `services/mcp-gateway` y cliente MCP.
- Herramienta de alta de cuenta: lee el `lead` del visitante y convierte su
  usuario anónimo en permanente **conservando el mismo `auth.uid()`**, de modo
  que su historial de conversación sobrevive al registro. Esto funciona
  únicamente porque F2 eligió Anonymous Sign-In en lugar de una sesión propia.
- `services/connector-worker` con adaptadores MSP.
- Timeouts, rate limits por herramienta y `audit_events` poblado en serio.

**Congela.** El formato del registro de auditoría y el contrato de una
herramienta.

**Gate.** Una herramienta fuera de allowlist se rechaza y queda auditada; un
timeout corta sin colgar el stream; los tests de permisos por rol pasan.

**Decisiones aplazadas a su spec.** Qué MSP concretos; si el agente decide
herramientas por tool-calling del modelo o por reglas; si el alta de cuenta
exige confirmación humana explícita —probablemente sí.

---

## F5 · Operación ⬜

**Objetivo.** Que Tess se pueda poner en producción y se sepa qué pasa cuando
falla.

**Entrega prevista.**

- Dockerfiles y despliegue a Cloud Run para `api`, `ingest-worker`,
  `connector-worker` y `mcp-gateway`.
- CI/CD completo, incluyendo publicación de los paquetes npm.
- Sentry con `release` versionado y source maps subidos en el build, en las
  tres superficies: frontend, API y workers. La configuración ya está
  andamiada en `src/instrument.ts` de cada servicio.
- OpenTelemetry, logs estructurados, p50/p95 y pruebas de carga.
- Threat model y scrubbing de PII: ni prompts completos, ni contenido
  documental, ni correos de leads salen hacia Sentry.

**Gate.** Un error de producción aparece en Sentry con source map resuelto y
traza correlacionada UI↔API; el p95 está dentro de objetivo bajo carga; no
aparece PII en los logs.

**Decisiones aplazadas a su spec.** Región de Cloud Run; estrategia de
versionado de los paquetes —changesets o manual—; si el panel admin sale a
producción en esta fase o después.

---

## Qué cambió respecto al plan original

El roadmap de `docs/plan-arquitectura-tess-typescript-supabase.md` sigue siendo
válido en su estructura. Dos cosas se movieron:

1. **F2 absorbió la identidad del visitante y la captura de leads.** El plan
   original solo contemplaba usuarios autenticados. El producto vive en
   landings públicas, así que el interlocutor por defecto no tiene cuenta.
2. **F2 absorbió la UI de chat.** F1 la dejó fuera explícitamente, a la espera
   de conocer la forma real del stream.

Ninguna de las dos altera las fronteras entre fases. F2 sigue entregando
«backend de chat»; solo resultó ser más grande de lo que el plan original
suponía.

## Mantenimiento

Al cerrar una fase:

1. Marcar su estado en la tabla **Estado** con el SHA del merge.
2. Mover sus contratos de «se congela en» a congelados, con la ruta del archivo
   donde viven.
3. Anotar la deuda que hereda la fase siguiente, si la hay.
4. Escribir el spec de la fase siguiente y enlazarlo.

Lo que **no** se hace: reescribir el histórico de una fase cerrada. Si una
decisión de F2 resultó equivocada, se corrige en el spec de la fase que la
arregla, y aquí se anota el cambio.
