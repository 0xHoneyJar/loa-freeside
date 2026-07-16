import { describe, expect, it } from 'vitest';
import { HttpLifecyclePublisher } from '../lifecycle-publisher.js';

describe('HttpLifecyclePublisher', () => {
  it('bounds a stalled lifecycle ingress and leaves failure retryable to the outbox caller', async () => {
    const stalled = ((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch;
    const publisher = new HttpLifecyclePublisher({ url: 'https://events.example.test', timeoutMs: 5 }, stalled);
    await expect(publisher.publish('orders.lifecycle.placed.v1', { order_id: 'ord_1' })).rejects.toBeDefined();
  });
});
