import type { AssistantStreamEvent } from '@teams4soft/tess-types';
import { describe, expect, it } from 'vitest';
import { createNoopTessClient } from './index.js';

describe('createNoopTessClient', () => {
  it('satisface TessClientLike sin emitir eventos', async () => {
    const client = createNoopTessClient();
    const received: AssistantStreamEvent[] = [];
    for await (const event of client.sendMessage({
      conversationId: 'c1',
      text: 'hola',
    })) {
      received.push(event);
    }
    expect(received).toEqual([]);
  });
});
