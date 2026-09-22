/**
 * Chat vía OpenRouter, por REST.
 *
 * No se usa `@openrouter/ai-sdk-provider`: su versión con soporte de
 * embeddings exige `ai@^7` y el repo estaba en `ai@5`. Migrar dos majors para
 * envolver una llamada HTTP no sale a cuenta cuando `ModelProvider` ya es la
 * abstracción que protege de un cambio de proveedor. Ver el spec de F3.
 *
 * La clave vive solo en el servidor; jamás en el bundle del web component.
 */
import type { ModelProvider, ModelStreamInput } from './model-provider.js';
import { leerStreamOpenRouter } from './openrouter-stream.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Política de proveedores subyacentes.
 *
 * Centralizar en OpenRouter no es aislar: enruta a proveedores de cómputo
 * distintos, y por ahí pasan los prompts y los fragmentos de documentación
 * privada del cliente. El default es restrictivo.
 *
 * `allow_fallbacks: false` es deliberado en F3. Un fallback puede cambiar
 * estilo, adherencia al prompt, idioma y manejo de contexto largo; con Tess
 * respondiendo documentación corporativa, preferimos un error honesto a una
 * respuesta de un modelo que nadie aprobó.
 */
const POLITICA_DE_PROVEEDOR = {
  data_collection: 'deny',
  allow_fallbacks: false,
  require_parameters: true,
} as const;

export interface OpenRouterModelOptions {
  apiKey: string;
  model: string;
  referer?: string | undefined;
  appTitle?: string | undefined;
  /**
   * Sin `max_tokens`, OpenRouter reserva 65536 tokens para la respuesta, y
   * una clave con límite de gasto rechaza la petición entera (visto en el
   * preflight). Obligatorio para no depender de ese default.
   */
  maxTokens: number;
  /** Inyectable para poder probar sin red. */
  fetchImpl?: typeof fetch | undefined;
}

export function createOpenRouterModelProvider(options: OpenRouterModelOptions): ModelProvider {
  const llamar = options.fetchImpl ?? fetch;

  return {
    async *stream(input: ModelStreamInput) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (options.referer) headers['HTTP-Referer'] = options.referer;
      if (options.appTitle) headers['X-Title'] = options.appTitle;

      const respuesta = await llamar(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: options.model,
          messages: input.messages,
          stream: true,
          max_tokens: options.maxTokens,
          provider: POLITICA_DE_PROVEEDOR,
        }),
        signal: input.signal,
      });

      if (!respuesta.ok) {
        // El prompt NO va en el error: lleva el system prompt del proyecto y
        // fragmentos de la documentación del cliente.
        throw new Error(`OpenRouter respondió ${respuesta.status}`);
      }

      if (!respuesta.body) {
        throw new Error('OpenRouter respondió sin cuerpo');
      }

      const requestId = respuesta.headers.get('X-Generation-Id') ?? undefined;
      let actualModel: string | undefined;

      for await (const chunk of leerStreamOpenRouter(respuesta.body)) {
        if (input.signal.aborted) return;

        // El modelo real llega en cada chunk; solo se notifica cuando cambia,
        // que en la práctica es una vez.
        if (chunk.model && chunk.model !== actualModel) {
          actualModel = chunk.model;
          input.onMetadata?.({
            provider: 'openrouter',
            requestedModel: options.model,
            actualModel,
            requestId,
          });
        }

        // Los chunks sin texto —el de `usage`— no se emiten.
        if (chunk.texto) yield chunk.texto;
      }
    },
  };
}
