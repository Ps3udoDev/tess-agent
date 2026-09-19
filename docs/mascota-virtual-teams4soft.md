# Mascota virtual de Teams4Soft

## Síntesis ejecutiva

**Recomendación:** construir el MVP con una mascota **2D vectorial en SVG**, encapsulada en un Web Component TypeScript y animada mediante CSS y una pequeña máquina de estados en JavaScript. El chat debe ser HTML accesible y debe abrirse desde un botón real, no desde un canvas. Esta ruta ofrece el menor riesgo de descarga, latencia, compatibilidad, mantenimiento y accesibilidad, y permite reutilizar el mismo componente en landing pages y aplicaciones React, Vue, Svelte o vanilla.

Como **ruta posterior**, adoptar un modelo **3D GLB optimizado, creado en Blender y renderizado con Three.js**, solo después de validar que el personaje 2D genera suficiente adopción y que existe una necesidad clara de presencia espacial, expresividad corporal o diferenciación visual. GLB y Three.js no son alternativas excluyentes: GLB será el formato de entrega y Three.js el runtime. Rive es una alternativa intermedia sólida si el equipo necesita una mascota vectorial más compleja, con state machines y data binding, sin dar el salto al coste de un modelo 3D. Live2D Cubism queda como opción especializada para una mascota 2D muy expresiva basada en rig y deformaciones, pero no como primera elección por su pipeline de arte y la revisión de licencia de publicación.

La arquitectura debe separar tres responsabilidades. La capa visual recibe estados semánticos y los representa. La UI gestiona el botón, el diálogo, el foco, el texto y los errores. El backend autentica, recupera documentación autorizada, llama al modelo de lenguaje y transmite la respuesta. La mascota **no** debe contener claves, documentos privados, lógica RAG ni decisiones de negocio.

El concepto propuesto es **Tess**, una pequeña mascota geométrica inspirada en un nodo de conexión: cuerpo redondeado, dos “antenas” que forman una T sutil y una cara mínima. Su paleta usa azul profundo, cian y coral como acento, con una variante de alto contraste. Tess es cálida, precisa y curiosa; acompaña sin simular una autoridad humana. Sus estados mínimos son `idle`, `hover/focus`, `listening`, `thinking`, `speaking`, `success`, `error`, `offline` y `reduced-motion`.

El programa debe avanzar en cuatro fases. La primera valida concepto, accesibilidad y contrato de estados. La segunda construye el MVP 2D y el backend de chat/RAG. La tercera mide uso y rendimiento en una landing y una aplicación real. La cuarta decide, con evidencia, si conviene enriquecer la mascota 2D con Rive o Live2D, o lanzar la variante 3D con GLB y Three.js.

## Decisión de producto y alcance

La mascota debe cumplir tres objetivos: hacer visible el acceso al asistente, comunicar el estado de una consulta y aportar identidad de marca. No debe convertirse en el producto principal ni en el único canal para entender la respuesta. El contenido útil seguirá siendo texto HTML, con fuentes y acciones explícitas cuando corresponda.

Para el MVP se recomienda una sola mascota, una sola variante visual y una sola superficie de interacción: un botón que abre un panel o diálogo de chat. El componente debe publicarse como paquete interno, por ejemplo `@teams4soft/mascot`, con una API agnóstica:

```text
state: idle | hover | listening | thinking | speaking | success | error | offline | reduced-motion
openChat(): void
closeChat(): void
setState(state): void
destroy(): void
mascot:activate
mascot:state-change
mascot:error
```

El contrato debe ser semántico. Ningún proyecto consumidor debería depender de nombres internos de capas, clips o animaciones. Así, el equipo puede rediseñar a Tess sin romper la integración del chat.

## Concepto concreto: Tess, el nodo que conecta conocimiento y personas

**Forma.** Tess es una figura compacta de bordes redondeados, aproximadamente cuadrada, con una ligera asimetría que evita el aspecto de icono genérico. Dos apéndices cortos sugieren una letra T o una señal de conexión. Los ojos son dos puntos o pequeñas cápsulas. La boca cambia poco: una línea curva basta para comunicar escucha, atención y respuesta. El diseño debe funcionar en un área de 48 a 96 píxeles sin perder legibilidad.

**Paleta.** El cuerpo utiliza azul profundo `#123B66`, asociado con confianza y tecnología. Las superficies secundarias usan cian `#34C6D8`, que aporta energía sin saturar la interfaz. Coral `#F47C6C` se reserva para atención, éxito visual o llamadas a la acción. El fondo claro es `#F7FAFC` y el texto principal `#12212F`. Deben existir tokens para modo oscuro y para contraste reforzado. La paleta no debe ser el único canal para distinguir estados.

**Personalidad.** Tess es directa, amable y curiosa. Dice o muestra “estoy escuchando”, “estoy buscando” y “esto es lo que encontré”, pero no afirma tener sentimientos ni conocimiento ilimitado. El tono de la interfaz debe ser profesional, breve y transparente cuando no existe evidencia suficiente. La animación acompaña el estado; no debe distraer ni sugerir que una respuesta está validada antes de que el backend la complete.

**Estados visuales.** En `idle`, Tess respira con una microanimación discreta. En `hover/focus`, orienta ligeramente la mirada y muestra un anillo de foco real en el botón. En `listening`, dirige la atención al campo de entrada. En `thinking`, usa un pulso lento y limitado, sin bucles intensos. En `speaking`, activa una variación suave de boca u ojos mientras llegan deltas de texto; el contenido de la respuesta se mantiene en el DOM. En `success`, hace una confirmación breve y vuelve a `idle`. En `error`, cambia a una pose estática con un mensaje textual y una acción para reintentar. En `offline`, conserva el botón y explica que el asistente no está disponible. En `reduced-motion`, se eliminan los bucles y se usan cambios estáticos de color, forma o texto.

## Por qué empezar con 2D y no con 3D

La diferencia no es solo estética. En una landing page, la mascota compite con el contenido por red, CPU, memoria, batería y atención. Una SVG pequeña puede estar visible inmediatamente, escalar sin pérdida y usar animaciones CSS limitadas a `transform` y `opacity`, propiedades que suelen evitar trabajo innecesario de layout y pintura [1] [2]. El mismo archivo puede reutilizarse sin cargar un motor de renderizado, decodificadores, shaders o texturas.

La ruta 2D también simplifica la accesibilidad. La mascota puede ser decorativa dentro de un botón cuyo nombre, foco y teclado son HTML. El diálogo y la región `aria-live` permanecen fuera de la animación. Un canvas WebGL, tanto 2D como 3D, es esencialmente un bitmap para las tecnologías asistivas y no debe ser el único control ni el único canal de información [3].

La ruta 3D es valiosa cuando el personaje debe expresar postura, profundidad, orientación, interacción espacial o una presencia de marca que justifique su coste. Un modelo GLB puede contener materiales, skins y animaciones, y Three.js ofrece `GLTFLoader`, `AnimationMixer` y compresión mediante Meshopt, Draco y KTX2/Basis [4] [5]. Sin embargo, textura, geometría, materiales, decodificación, shaders y memoria GPU introducen más variables. El 3D también exige manejar pérdida de contexto WebGL, límites de DPR, calentamiento del dispositivo y un fallback estático [6].

Por tanto, **2D es la decisión de producto para aprender con bajo coste** y **3D es una extensión de diferenciación**, no una condición para demostrar el valor del asistente. Si las métricas muestran que la mascota apenas influye en apertura o conversión, el 3D no resolverá el problema. Si muestran que la presencia y expresividad sí son decisivas, la inversión posterior estará justificada.

## Tabla comparativa de rutas

| Ruta                      | Recomendación                  | Ventajas principales                                                                                                                        | Costes y riesgos                                                                                                                                         | Uso recomendado                                                              |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| SVG + CSS + Web Component | **MVP recomendado**            | Menor peso y latencia; nitidez en cualquier DPR; fácil integración multi-framework; accesibilidad y fallback simples; runtime del navegador | Se vuelve difícil de mantener con deformaciones, lip-sync o muchas secuencias; SVG complejo con filtros puede ser costoso                                | Mascota de soporte, identidad de marca y estados breves                      |
| Lottie/dotLottie          | Complemento selectivo          | Buenas interpolaciones y secuencias; un archivo puede contener varias animaciones; controles de reproducción maduros [7] [8]                | Player, parseo, memoria y compatibilidad adicionales; animaciones complejas pueden degradar móviles; assets tienen licencias separadas                   | Escenas concretas que serían demasiado laboriosas en CSS                     |
| Rive                      | Alternativa 2D avanzada        | State machines, data binding, componentes reutilizables y control visual en runtime; buena transición entre estados [9] [10]                | Hay que medir runtime y `.riv`; cleanup, reduced motion y Semantics requieren disciplina; editor y planes comerciales son distintos del runtime MIT [11] | Evolución 2D si SVG ya no expresa el personaje                               |
| Live2D Cubism             | Alternativa 2D expresiva       | Rig, motions, physics, expresiones y lip-sync; sensación de personaje vivo [12] [13]                                                        | Pipeline de arte más especializado; WebGL, texturas y ciclo de vida; licencia de publicación debe confirmarse por escrito [14]                           | Mascota tipo personaje, especialmente si la voz y la expresión son centrales |
| GLB + Three.js            | **Ruta posterior recomendada** | Presencia 3D, animaciones con clips, formato abierto y reutilizable; compresión de geometría y texturas [4] [5]                             | Mayor coste de bytes, decodificación, GPU, contexto WebGL y mantenimiento; requiere fallback                                                             | Diferenciación de marca tras validar demanda y presupuesto                   |
| Sprite sheet              | Caso específico                | Muy simple y predecible para secuencias fijas; poco trabajo de runtime [15]                                                                 | Bitmap escalable con limitaciones; difícil recolorear, adaptar poses o mantener muchas variantes                                                         | Mascota pixel-art o secuencia raster deliberadamente fija                    |

La tabla no implica que todas las rutas deban construirse. Para Teams4Soft, la secuencia más prudente es **SVG primero**, después **Rive** si se necesita una animación 2D más sofisticada y finalmente **GLB + Three.js** si el producto demuestra que la presencia 3D aporta valor. Live2D debe activarse solo con aprobación jurídica y una necesidad clara de personaje expresivo.

## Arquitectura propuesta

### 1. UI y componente visual

El componente debe publicarse como ESM y como Web Component. Los adaptadores React, Vue o Svelte pueden ser envoltorios del mismo núcleo, no implementaciones independientes. El núcleo gestiona estados, eventos, reduced motion, carga de assets y destrucción. El host de la aplicación conserva la lógica de apertura del chat.

La estructura recomendada es:

```text
Teams4Soft page/app
├── <teams4soft-mascot> o adaptador React/Vue
│   ├── SVG decorativo y animaciones de estado
│   └── button HTML: nombre, foco, teclado, aria-expanded
├── chat dialog/panel HTML
│   ├── historial y fuentes
│   ├── input y botón enviar
│   ├── aria-live para estados y nuevos mensajes
│   └── cierre, Escape y retorno de foco
└── cliente de API
    └── eventos whitelist: listening, thinking, speaking, completed, error
```

El botón debe tener un nombre como “Abrir chat con la mascota de Teams4Soft”. Debe responder a Enter y Space, mostrar foco visible, tener un objetivo táctil suficiente y reflejar `aria-expanded` y `aria-controls`. Si el SVG no aporta información adicional, debe marcarse como decorativo. El panel debe seguir el patrón de diálogo de WAI-ARIA: foco inicial dentro, cierre con Escape, botón visible, nombre accesible y retorno del foco al invocador [16].

### 2. LLM y RAG

El flujo de datos recomendado es:

```text
Usuario
  -> botón y diálogo HTML
  -> POST /api/chat o conexión de streaming
  -> autenticación y autorización de Teams4Soft
  -> recuperación semántica en vector store con filtros de tenant/producto/versión
  -> modelo de lenguaje
  -> texto, fuentes y eventos de dominio
  -> UI de chat + estado visual de Tess
```

El servidor debe recibir un `sessionId`, el mensaje y el contexto mínimo necesario. Debe autenticar al usuario, aplicar límites de frecuencia y tamaño, filtrar los documentos disponibles y recuperar fragmentos pertinentes. Retrieval y File Search proporcionan búsqueda semántica sobre vector stores y pueden devolver el origen de los fragmentos [17] [18]. El modelo debe recibir instrucciones para distinguir evidencia de inferencia y declarar que no dispone de información cuando el corpus no respalde una respuesta.

La respuesta puede transmitirse mediante Server-Sent Events. El cliente traduce eventos de dominio a estados visuales:

| Evento de backend      | UI de chat                      | Estado de Tess           |
| ---------------------- | ------------------------------- | ------------------------ |
| `message.started`      | Estado “Buscando información…”  | `thinking`               |
| Primer `message.delta` | Aparece el texto incremental    | `speaking`               |
| `message.completed`    | Se muestran respuesta y fuentes | `success` y luego `idle` |
| `error` o timeout      | Mensaje de error y reintento    | `error`                  |
| Sin red                | Aviso de modo offline           | `offline`                |

El texto parcial no debe ejecutar acciones. Si el asistente necesita function calling, el servidor debe validar esquema, usuario, permisos y parámetros antes de ejecutar una mutación. La moderación de parciales, la detección de prompt injection, el filtrado de PII y la política de retención deben vivir en backend. Las claves de proveedor, los identificadores privilegiados de vector store y los documentos no deben llegar al navegador.

### 3. Voz opcional

La voz debe ser una segunda etapa, no una dependencia del MVP. El camino seguro es generar audio en backend mediante TTS autorizado, reproducirlo en cliente y enviar al runtime solo una señal de amplitud normalizada o un conjunto de visemas. Live2D documenta una entrada de lip-sync basada en un valor de volumen entre 0 y 1 [13]. En una solución 2D SVG, basta inicialmente con una animación de boca vinculada a la llegada de texto; no debe presentarse como sincronización fonética real.

La interfaz debe ofrecer controles explícitos para activar, pausar y detener audio. Debe respetar `prefers-reduced-motion` y preferencias de accesibilidad. El chat siempre debe poder utilizarse sin voz y sin animación.

## Estrategia de rendimiento y operación

El MVP debe cargar el SVG crítico con el shell de la página y diferir cualquier runtime adicional. Lottie, Rive, datos 3D, decodificadores y voz deben cargarse bajo demanda, al entrar en viewport o cuando el usuario active el chat. Los assets versionados deben servirse desde CDN con compresión Brotli y caché inmutable; el paquete JavaScript debe fijar una versión, no usar `latest`.

La animación SVG debe limitarse a `transform` y `opacity` siempre que sea posible. Hay que evitar filtros, blur, máscaras complejas y cientos de nodos. `IntersectionObserver` debe detener o desmontar el componente cuando no sea visible. La página debe poder detener los loops si la mascota está fuera de pantalla, si la pestaña está oculta o si el usuario activa reduced motion. WCAG incluye requisitos para pausar, detener u ocultar animaciones persistentes y para reducir la animación iniciada por interacción [19] [20].

El presupuesto inicial debe ser una hipótesis de trabajo, no una promesa. Para el MVP se propone mantener el SVG base por debajo de **50 KB comprimidos**, sin contar la aplicación, y no cargar un runtime secundario antes de la interacción. Para la futura variante 3D se propone comenzar con **1–2 MB comprimidos para el GLB**, texturas móviles de 256–512 píxeles, 20–40 mil triángulos visibles y una sola escena, siempre sujeto a validación en dispositivos reales. El análisis de Blender y Three.js confirma que el tamaño real depende principalmente de texturas, materiales, geometría, animaciones y decodificación [4] [21].

La telemetría mínima debe registrar p50, p75 y p95 de tiempo hasta mascota visible, tiempo desde clic hasta panel, tiempo hasta primer estado `thinking`, tiempo hasta primer token, errores de carga, abandono, FPS o frames perdidos en la ruta 3D, pérdida de contexto WebGL y uso de memoria cuando sea medible. También deben observarse conversión de apertura, preguntas completadas, reintentos, respuestas sin evidencia y satisfacción. No se debe optimizar solo el peso del archivo: una compresión que aumenta demasiado el tiempo de decodificación puede empeorar la experiencia.

En la ruta 3D, Three.js debe limitar el pixel ratio, evitar sombras y postprocesado por defecto, pausar el `requestAnimationFrame` cuando no haya animación útil y liberar geometrías, materiales, texturas y renderer al desmontar [22] [23]. Debe existir una imagen o SVG de fallback cuando WebGL no esté disponible o pierda el contexto. En la ruta Rive, el componente debe limpiar listeners, artboards y recursos nativos; si se comparten archivos, hay que aplicar el patrón de caché recomendado sin utilizar el modo incompatible con el renderer elegido [24].

## Roadmap en cuatro fases

### Fase 1 — Definición y prototipo validable

**Objetivo:** cerrar el concepto y reducir riesgos antes de producir un sistema completo. Diseñar dos o tres variantes de Tess y validar la forma a 48, 72 y 96 píxeles. Definir la paleta, el tono, la guía de estados y el contrato de eventos. Crear el botón y un diálogo HTML estático con teclado, foco, lector de pantalla, alto contraste y reduced motion.

El entregable es un prototipo clicable sin LLM. La decisión de salida exige que una persona pueda abrir y cerrar el chat sin ratón, entender cada estado sin depender del color y utilizar el panel aunque la mascota desaparezca. En paralelo, el equipo debe auditar las licencias de cualquier fuente, ilustración, audio o asset externo.

### Fase 2 — MVP 2D integrado

**Objetivo:** desplegar SVG + CSS + Web Component en una landing y una aplicación. Implementar la máquina de estados, lazy loading de elementos no críticos, fallback y telemetría. Conectar `/api/chat` a un backend autenticado con recuperación documental, respuesta con fuentes y streaming opcional.

El MVP debe incluir `thinking`, `speaking`, `success`, `error` y `offline`, aunque la expresión sea deliberadamente sencilla. La aceptación requiere que la respuesta textual, el foco, el lector de pantalla y los errores funcionen sin la animación. También se debe probar una variante de Lottie solo si una secuencia concreta no puede expresarse razonablemente con CSS.

### Fase 3 — Piloto, medición y endurecimiento

**Objetivo:** medir la experiencia en tráfico real controlado. Comparar una landing con mascota frente a una variante sin mascota o con una versión estática. Probar Safari iOS, Chrome Android de gama baja y media, Firefox y Chromium de escritorio, además de red 3G/4G simulada, zoom del 200 %, teclado y tecnologías asistivas.

Analizar apertura del chat, abandono, tiempo hasta primera respuesta, preguntas resueltas, latencia p95, errores de RAG, coste por conversación, consumo y métricas de página. Corregir prompt injection, respuestas sin evidencia, rate limits, cancelación de streaming, limpieza de componentes y fugas en navegación SPA. La fase termina con un informe de decisión basado en datos.

### Fase 4 — Evolución visual y voz

**Objetivo:** elegir una ampliación justificada por el piloto. Si se necesita más expresividad sin presencia 3D, probar Rive con una máquina de estados pública y data binding, o Live2D si la personalidad tipo personaje y el lip-sync son prioritarios. Confirmar planes, derechos y condiciones de publicación antes de comprar o distribuir assets [9] [14].

Si se necesita presencia espacial y el impacto comercial lo justifica, producir el modelo maestro en Blender, exportar GLB 2.0, validar con Khronos glTF Validator y cargarlo con Three.js. Mantener a Tess 2D como fallback y como versión preferida para dispositivos con bajo rendimiento. Incorporar voz solo con controles claros, consentimiento y una política de accesibilidad. La ruta 3D no debe reemplazar al canal textual.

## Criterios de decisión para el dueño de Teams4Soft

La inversión debe aprobarse cuando el MVP demuestra que la mascota aumenta la apertura o la confianza sin degradar las métricas de página, que el chat es útil con evidencia y que la accesibilidad es equivalente con o sin animación. No se debe aprobar una ruta 3D únicamente porque sea más llamativa.

La ruta posterior debe evaluarse con cinco preguntas. ¿La mascota 2D limita una interacción importante? ¿Los usuarios comprenden mejor los estados con más expresividad? ¿El presupuesto de red, GPU y mantenimiento está respaldado por conversión o retención? ¿Existe un equipo que pueda mantener arte, runtime y pruebas multi-dispositivo? ¿Las licencias de los modelos, runtimes, fuentes, audio y assets están documentadas?

La decisión recomendada hoy es, por tanto, **aprobar el MVP SVG/CSS y reservar presupuesto de aprendizaje para la fase 3**. El dueño obtiene una experiencia diferenciada y reutilizable sin comprometer la velocidad de las páginas. La opción 3D queda preparada como evolución de marca, no como deuda técnica obligatoria desde el primer día.

## Referencias

[1]: https://developer.mozilla.org/en-US/docs/Web/SVG 'MDN: SVG'
[2]: https://web.dev/articles/animations-guide 'web.dev: How to create high-performance CSS animations'
[3]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas 'MDN: HTML canvas element'
[4]: https://threejs.org/docs/pages/GLTFLoader.html 'Three.js: GLTFLoader'
[5]: https://www.khronos.org/gltf/ 'Khronos Group: glTF'
[6]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API 'MDN: WebGL API'
[7]: https://dotlottie.io/spec/1.0/ 'dotLottie v1.0 Specification'
[8]: https://docs.lottiefiles.com/en/runtimes/distributions/js 'LottieFiles: dotLottie JavaScript Player'
[9]: https://rive.app/docs/runtimes/web/web-js 'Rive: Web JS runtime'
[10]: https://rive.app/docs/runtimes/data-binding 'Rive: Data binding'
[11]: https://rive.app/pricing 'Rive: pricing and plan capabilities'
[12]: https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/ 'Live2D: Cubism SDK for Web'
[13]: https://docs.live2d.com/en/cubism-sdk-manual/lipsync/ 'Live2D: lip-sync'
[14]: https://www.live2d.com/en/sdk/license/ 'Live2D: SDK and publication license'
[15]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Images/Implementing_image_sprites 'MDN: Implementing image sprites in CSS'
[16]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ 'WAI-ARIA Authoring Practices: dialog modal pattern'
[17]: https://developers.openai.com/api/docs/guides/retrieval 'OpenAI: Retrieval'
[18]: https://developers.openai.com/api/docs/guides/tools-file-search 'OpenAI: File Search'
[19]: https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html 'W3C: WCAG 2.2.2 Pause, Stop, Hide'
[20]: https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions 'W3C: WCAG 2.3.3 Animation from Interactions'
[21]: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html 'Blender Manual: glTF 2.0 export'
[22]: https://threejs.org/manual/pages/rendering-on-demand.html 'Three.js Manual: rendering on demand'
[23]: https://threejs.org/manual/pages/cleanup.html 'Three.js Manual: cleanup'
[24]: https://rive.app/docs/runtimes/web/caching-a-rive-file 'Rive: caching a RiveFile'
