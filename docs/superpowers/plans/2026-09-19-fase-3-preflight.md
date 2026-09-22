# Fase 3 — Preflight de OpenRouter

Fecha de verificación: 2026-09-22

## Resultados

| Comprobación                               | Resultado                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Cuenta con saldo                           | Sí                                                                        |
| Clave de desarrollo con límite de gasto    | Sí — el límite es bajo: rechaza peticiones que pidan más de ~4000 tokens  |
| `openai/text-embedding-3-small` disponible | Sí (la respuesta lo nombra `text-embedding-3-small`, sin prefijo)         |
| Dimensiones devueltas                      | **1536**                                                                  |
| Modelo de chat fijado                      | `anthropic/claude-sonnet-5`                                               |
| Streaming SSE funciona                     | Sí: líneas `data: {...}` con `choices[0].delta` y cierre `data: [DONE]`   |
| Aparecen líneas `: OPENROUTER PROCESSING`  | **Sí**, intercaladas entre los `data:`                                    |
| Alerta de presupuesto configurada          | Pendiente de confirmar en el panel de OpenRouter                          |

## Hallazgo: sin `max_tokens` la petición de chat falla

La primera llamada de streaming, sin `max_tokens`, devolvió un error (no un
stream): OpenRouter reserva el máximo del modelo (65536 tokens) y la clave no
llega a cubrirlo. Con `max_tokens: 100` la misma petición funcionó.

El plan no fija `max_tokens` en ningún sitio. La Tarea 16 debe enviarlo
siempre, con un valor acotado y configurable; si no, cualquier clave con
límite de gasto rompe el chat, y sin límite cada respuesta reserva un
presupuesto desproporcionado.

## Consecuencias

- `EMBEDDING_DIMENSIONS` queda en 1536 y la columna `vector(1536)` no se toca.
- `OPENROUTER_CHAT_MODEL` queda fijado a versión explícita, nunca a un alias.
- `allow_fallbacks: false` en F3.
- La respuesta de embeddings no repite el prefijo del proveedor en `model`: el
  código no debe comparar `j.model` con `OPENROUTER_EMBEDDING_MODEL`.
- El parser SSE de la Tarea 15 tiene que saltar las líneas de comentario
  (`: ...`); aparecen en la práctica.
