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
| F3   | RAG                         | ✅ **Cerrada** — PR #N, merge `<sha>`   | `specs/2026-09-19-fase-3-rag-design.md`               | `plans/2026-09-19-fase-3-rag.md`               |
| F4   | Agente, MCP y conectores    | ⬜ No iniciada                          | —                                                     | —                                              |
| F5   | Operación                   | ⬜ No iniciada                          | —                                                     | —                                              |

## Mapa de contratos

Un contrato congelado no se renegocia. Puede **ensancharse de forma aditiva**
—añadir un campo opcional, un método opcional, un endpoint nuevo— pero no
cambiar de forma ni de significado.

| Contrato                                          | Se congela en | Lo consume                            | Dónde vive                                                      |
| ------------------------------------------------- | ------------- | ------------------------------------- | --------------------------------------------------------------- |
| `AssistantState` — 7 estados                      | **F1** ✅     | F2 vía SSE, F4                        | `packages/tess-types/src/assistant.ts`                          |
| Atributos, métodos y eventos del web component    | **F1** ✅     | todas                                 | `packages/tess-web-component/src/element.ts`                    |
| `AssistantStreamEvent` — 5 eventos                | **F1** ✅     | F2 lo produce, F3 emite `source`      | `packages/tess-types/src/events.ts`                             |
| Contrato del `.riv` — 3 triggers, 4 booleanos     | **F1** ✅     | solo `tess-rive`                      | `packages/tess-rive/src/contract.ts`                            |
| Esquema Supabase base — 12 tablas + RLS           | pre-F1 ✅     | F2, F3, F4                            | `supabase/migrations/0001`–`0007`                               |
| `TessClientLike` — cliente HTTP/SSE               | **F2** ✅     | F3, F4                                | `packages/tess-types/src/client.ts`                             |
| Modelo de identidad — visitante, usuario, miembro | **F2** ✅     | F3, F4, F5                            | `supabase/migrations/0008`–`0010`                               |
| Esquemas zod de la API                            | **F2** ✅     | F3, F4                                | `packages/tess-types/src/api.ts`                                |
| `ModelProvider` — interfaz de streaming           | **F2** ✅     | F3 le añade contexto, F4 herramientas | `services/api/src/agent/model-provider.ts`                      |
| Secuencia de eventos SSE                          | **F2** ✅     | F3, F4                                | `packages/tess-types/src/events.ts`                             |
| Forma de las citas — `messages.sources`           | **F3** ✅     | F4, panel admin                       | `packages/tess-types/src/client.ts` y `0004_chat_schema.sql`   |
| Estrategia de chunking                            | **F3** ✅     | worker de ingesta                     | `services/ingest-worker/src/chunk.ts`                           |
| `EmbeddingProvider` — vectorización               | **F3** ✅     | API y worker                          | `packages/tess-embeddings/src/provider.ts`                      |
| Firma de `match_document_sections`                | **F3** ✅     | API Fastify                           | `supabase/migrations/0007_rag_fn.sql` (actualizada en 0013/0014)|
| Binding de sesión de visitante                    | **F3** ✅     | RLS en Supabase                       | `supabase/migrations/0012_visitor_sessions.sql`                 |
| Allowlist de herramientas MCP                     | **F4**        | F5                                    | `assistant_configs.enabled_tools` (ya existe)                   |
| Formato de `audit_events.metadata`                | **F4**        | F5                                    | `supabase/migrations/0005` (tabla ya existe)                    |

### Contratos que el esquema ya reserva

Dos columnas del esquema base existen desde antes de F1 y **nadie las escribe
todavía**. No son deuda: son fronteras reservadas.

- `assistant_configs.enabled_tools` — allowlist de herramientas. La puebla F4.
- `audit_events` — auditoría. La escribe F2 y F3 de forma puntual y F4 en serio.

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

**Hallazgo posterior (resuelto en F3):** Con las políticas de `0006_rag_schema.sql` un visitante anónimo obtenía cero filas de RAG, ya que las políticas de `document_sections` exigían membresía de proyecto. La migración `0013_rag_visitor_policy.sql` resolvió esto habilitando la consulta vía `match_document_sections()` con verificación de la sesión del visitante.

---

## F3 · RAG ✅

**Objetivo.** Que Tess conteste **con la documentación del proyecto** y cite de
dónde lo sacó.

**Entregado.**

- Supabase Storage (`tess-documents`) con RLS y subida exclusiva para miembros del proyecto.
- `services/ingest-worker`: extracción de texto (PDF, Markdown, TXT), chunking jerárquico determinista, embeddings vía OpenRouter REST (`openai/text-embedding-3-small`, 1536 dimensiones) y persistencia en `document_sections` y `document_embeddings`. Fuera de la petición HTTP.
- Recuperación vía `match_document_sections()` (`security invoker`), con RLS estricto multi-tenant y binding de visitante.
- Emisión de `assistant.source` antes del primer `assistant.delta`.
- `messages.sources` poblado con detalle de sección y documento.
- Degradación elegante del chat ante fallos de embeddings con registro en `audit_events` (`rag.retrieval.failed`).
- UI de citas dentro del mensaje en `@teams4soft/tess-web-component` accesible con `aria-live`.
- Rate limiting de 30 mensajes / 5 minutos por conversación en el API.
- Migraciones `0011`–`0014`: Storage, `visitor_sessions`, política RLS de RAG para visitantes y umbral de similitud.

**Congela.** La forma de la cita (`MessageSource`), la estrategia de chunking, `EmbeddingProvider`, la firma de `match_document_sections` y el binding de sesión de visitante.

**Gate.** Cumplido (`pnpm gate:f3` y smoke test contra OpenRouter). 19/19 comprobaciones en verde; 350 tests pasando; bundle web component en 215.2 kB; comprobaciones estructurales `scripts/check-f3.mjs` limpias; smoke test manual con subida de PDF real (`smoke.pdf`), embedding de 1536 dimensiones registrado en base de datos, conversación streaming con citas exactas desde OpenRouter y degradación ante API key no válida auditada. Registro en `docs/superpowers/plans/2026-09-19-fase-3-gate.md`.

**Deuda que hereda F4 y F5.**

1. `retry_count` y reencolado manual de documentos en `failed`: F3 hace un solo intento a propósito; queda para F5.
2. El índice HNSW usa `m = 16, ef_construction = 64`, los valores por defecto de `0003`, sin haberlos medido con datos reales (F5).
3. Durante una convivencia de dos modelos de embeddings, el filtro `e.model` se aplica después del recorrido del índice (F5).
4. `EMBEDDING_DIMENSIONS` está clavado a 1536 por la columna y el índice; cambiar a una familia con otra dimensión exige migrar columna, índice, validaciones y RPC como fase propia.
5. Política de proveedores de OpenRouter: falta la lista aprobada por escrito y la decisión sobre `zdr` (Zero Data Retention) antes de producción (F5).

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
3. **F3 sustituyó Vercel AI Gateway por OpenRouter por REST.** El adaptador con
   embeddings (`@ai-sdk/gateway`) exigía `ai@7`, mientras que el monorepo
   estaba en `ai@5`. Para evitar desestabilizar dependencias o forzar migraciones
   prematuras, F3 llama a OpenRouter directamente vía API REST estándar,
   eliminando además cualquier SDK propietario de IA del árbol de dependencias.

Ninguna de las modificaciones altera las fronteras entre fases. F2 sigue
entregando «backend de chat» y F3 «RAG con citas»; solo se ajustaron las
herramientas y el alcance concreto de ejecución.

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
