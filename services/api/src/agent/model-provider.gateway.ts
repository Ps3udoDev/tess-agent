/**
 * Proveedor real vía Vercel AI Gateway.
 *
 * Una sola credencial y un solo billing para todos los modelos del catálogo.
 * La clave vive solo en el servidor; jamás en el bundle del web component ni
 * en variables PUBLIC_ de Vercel.
 */
import { streamText } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import type { ModelProvider, ModelStreamInput } from './model-provider.js';

export interface GatewayOptions {
  model: string;
  apiKey?: string | undefined;
}

export function createGatewayModelProvider(options: GatewayOptions): ModelProvider {
  const gateway = createGateway(options.apiKey ? { apiKey: options.apiKey } : {});

  return {
    async *stream(input: ModelStreamInput) {
      const resultado = streamText({
        model: gateway(options.model),
        messages: input.messages,
        abortSignal: input.signal,
      });

      for await (const delta of resultado.textStream) {
        if (input.signal.aborted) return;
        yield delta;
      }
    },
  };
}
