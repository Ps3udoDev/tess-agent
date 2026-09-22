# Guía de Demostración PoC — Fase 3: RAG e Ingestión con Tess

Esta guía proporciona el paso a paso completo para levantar la solución de **Tess (Fase 3)**, entender el flujo de datos, diagnosticar los logs del sistema y realizar una demostración interactiva al equipo con un guión de preguntas recomendadas.

---

## 1. Arquitectura y Novedades de la Fase 3

En la Fase 3 se integró la capacidad de **Generación Aumentada por Recuperación (RAG)** y el **Pipeline de Ingestión Documental**:

- **Embeddings**: `openai/text-embedding-3-small` (1536 dimensiones) vía OpenRouter.
- **Base Vectorial**: Supabase Postgres con extensión `pgvector` e índice HNSW (`match_document_sections`).
- **LLM Streaming**: `google/gemini-2.5-flash` vía OpenRouter transmitiendo eventos SSE (`assistant.delta`, `tess:message`, `tess:sources`).
- **Citas Verificables**: El modelo genera citas numeradas `[1]`, `[2]` que el componente web mapea directamente a tarjetas interactivas con el extracto y el documento original.
- **Worker de Ingestión**: Servicio en segundo plano que vigila documentos en cola `pending`, extrae texto (PDFs y Markdown), divide en chunks semánticos con solapamiento y genera vectores.
- **UI Responsiva**: Web Component `<teams4soft-assistant>` con avatar SVG interactivo, máquina de estados y ventana de chat adaptativa sin desbordamiento de pantalla.

---

## 2. Explicación de los Logs del Ingest Worker

Al iniciar el worker de ingestión es posible que observes líneas como:

```json
{"level":50,"documentId":"...","razon":"el documento no tiene storage_path","msg":"fallo al procesar documento"}
{"level":50,"documentId":"...","razon":"no se pudo descargar: Object not found","msg":"fallo al procesar documento"}
```

### ¿Por qué ocurre esto?

1. **Residuos de pruebas automatizadas de seguridad (RLS)**: La suite de tests de la Fase 3 (`src/rls.test.ts` y tests de ingestión) inserta intencionalmente registros en la tabla `documents` con valores incompletos o sin subir binarios reales a Supabase Storage para comprobar que las políticas de seguridad y validaciones rechazan datos anómalos.
2. **Resiliencia del Worker**: Cuando el worker despierta y encuentra registros en estado `pending`, intenta reclamarlos (`claimed`) y procesarlos. Al detectar que no hay archivo físico o falta el path, **no se cae ni se bloquea**: registra el error y actualiza el estado a `failed`.
3. **Cómo dejar la base limpia para la PoC**:
   Para resetear la base de datos local y dejar únicamente los datos semilla limpios:
   ```powershell
   pnpm supabase:reset
   ```

---

## 3. Preparación del Entorno (3 Terminales)

Asegúrate de que Supabase local esté corriendo (`supabase status` o `pnpm supabase:start`). Luego abre 3 terminales en la raíz del proyecto:

### Terminal 1: API Backend (Fastify + OpenRouter SSE)

```powershell
pnpm --filter @teams4soft/api dev
```

> Corre en: `http://localhost:8080` (Health check: `http://localhost:8080/healthz`)

### Terminal 2: Worker de Ingestión

```powershell
pnpm --filter @teams4soft/ingest-worker dev
```

> Vigila la cola de documentos y genera embeddings al detectar nuevos archivos.

### Terminal 3: Aplicación Demo Frontend (Svelte 5)

```powershell
pnpm --filter @teams4soft/demo-svelte dev
```

> Abre tu navegador en: `http://localhost:5173`

---

## 4. Ingesta de un Documento de Prueba para la PoC

Para demostrar la capacidad RAG, puedes registrar un documento de conocimiento. Por ejemplo, utilizando `curl` contra el API local:

```powershell
# Inserción de un documento de texto corporativo de ejemplo
curl -X POST http://localhost:8080/v1/documents `
  -H "Authorization: Bearer pk_dev_tess_local_0001" `
  -H "Content-Type: application/json" `
  -d '{
    "title": "Políticas de Servicio Teams4Soft",
    "filename": "politicas-servicio.txt",
    "mimeType": "text/plain",
    "content": "Teams4Soft ofrece consultoría de software premium y desarrollo de agentes de IA autónomos. Nuestro tiempo de entrega para un MVP es de 4 semanas. La garantía de código cubre 12 meses tras el despliegue con soporte 24/7. El contacto directo para escalamiento comercial es ventas@teams4soft.com."
  }'
```

_(Si usas subida de PDF vía Supabase Storage, colócalo en el bucket `tess-documents` con la fila correspondiente en `documents` con estado `pending` y el worker lo procesará inmediatamente)_.

En la **Terminal 2 (Worker)** verás el log indicando:

- Reclamo de documento (`claimed`).
- Creación de chunks.
- Invocación a OpenRouter para calcular vectores.
- Estado final: `completed` con `N` secciones generadas.

---

## 5. Guión de Preguntas para Demostrar al Equipo

Abre `http://localhost:5173`. En la esquina inferior derecha verás el avatar de Tess. Haz clic para abrir el diálogo del chat.

### Caso 1: Saludo e Identidad del Asistente

- **Pregunta:**
  > «Hola, ¿quién eres y qué rol cumples?»
- **Qué observar en la demo:**
  - El avatar cambia inmediatamente a estado `thinking` (pensando).
  - Comienza el streaming de texto en tiempo real con efecto typing.
  - El avatar cambia a estado `speaking` durante la generación.
  - Tess responde con su personalidad oficial: asistente ejecutiva y técnica de Teams4Soft.

---

### Caso 2: Recuperación RAG y Cita Verificable de Fuentes

- **Pregunta:**
  > «¿Cuánto tiempo toma la entrega de un MVP con Teams4Soft y qué garantía ofrecen?»
- **Qué observar en la demo:**
  - El backend consulta pgvector y recupera la sección más afín del documento ingerido.
  - Tess responde: _«La entrega de un MVP se realiza en 4 semanas y la garantía de código cubre 12 meses con soporte 24/7 [1].»_
  - Debajo del mensaje aparece la sección interactiva de **Fuentes citadas [1]**, mostrando el título del documento y el fragmento original de donde extrajo el dato.
  - **Punto clave para el equipo:** No hay alucinación; el modelo sustenta cada afirmación en la base de datos vectorial de la empresa.

---

### Caso 3: Control Anti-Alucinación (Pregunta fuera de dominio)

- **Pregunta:**
  > «¿Cuál es la receta tradicional para preparar una lasagna boloñesa?»
- **Qué observar en la demo:**
  - El umbral de similitud vectorial no encuentra concordancia suficiente con los documentos corporativos.
  - Tess rechaza amablemente la solicitud: _«Mi conocimiento está enfocado en los servicios, capacidades y proyectos de Teams4Soft. No dispongo de información sobre recetas culinarias, pero con gusto puedo ayudarte con cualquier consulta sobre desarrollo de software o IA.»_
  - **Punto clave para el equipo:** Muestra seguridad y alineamiento estricto a las directrices de la empresa.

---

### Caso 4: Captura de Lead / Conversión Comercial

- **Pregunta:**
  > «Queremos cotizar un agente de IA para nuestra empresa, ¿cómo podemos avanzar?»
- **Qué observar en la demo:**
  - Tess detecta la intención comercial y despliega el formulario de lead integrado en el chat:
    - Nombre
    - Correo corporativo
    - Empresa
  - Al completar el formulario, se dispara el evento `tess:lead` y se guarda en la tabla `leads` de Supabase vinculada a la conversación activa.

---

### Caso 5: Controles Visuales del Panel de Pruebas

En la pantalla de `+page.svelte` también puedes demostrar a los diseñadores y desarrolladores:

1. **Selectores de Estado:** Forzar manualmente estados como `wave` (saludo), `alert` (aviso de error), `listening` o `idle`.
2. **Selector de Posición:** Cambiar entre `bottom-right`, `bottom-left`, `top-right`, `top-left` y verificar cómo el diálogo de chat se acomoda automáticamente sin salirse de la pantalla.
3. **Log de Eventos en Vivo:** Ver cómo cada acción (`tess:open`, `tess:message`, `tess:state`) emite CustomEvents estándar que cualquier aplicación host (React, Angular, Svelte, HTML vanilla) puede escuchar e integrar.
