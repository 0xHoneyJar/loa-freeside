import { describe, expect, it, vi } from 'vitest';
import type { IngredientStatus } from '@freeside/ordering-protocol';

import { HttpBuildingProbes } from '../http-building-probes.js';

const CHAIN = '1';
const CONTRACT = '0xED5AF388653567Af2F388e6224DcC93746104133';
const CONTRACT_LOWER = CONTRACT.toLowerCase();
const TOKEN = 'test-service-token';

function mockFetch(handlers: Record<string, (req: Request) => Response | Promise<Response>>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.href;
    const method = init?.method ?? 'GET';
    const key = `${method} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected fetch: ${key}`);
    }
    return handler(new Request(url, init));
  }) as typeof fetch;
}

function probes(fetchImpl: typeof fetch): HttpBuildingProbes {
  return new HttpBuildingProbes({
    sonarApiUrl: 'https://sonar.test',
    scoreApiUrl: 'https://score.test',
    worldsApiUrl: 'https://worlds.test',
    serviceToken: TOKEN,
    fetchImpl,
  });
}

describe('HttpBuildingProbes', () => {
  it('maps sonar status responses to ingredient statuses', async () => {
    const fetchImpl = mockFetch({
      [`GET https://sonar.test/v1/collections/${CHAIN}/${CONTRACT_LOWER}/status`]: () =>
        new Response(JSON.stringify({ status: 'indexed', holder_count: 100 }), { status: 200 }),
    });
    const p = probes(fetchImpl);
    await expect(p.probeSonar(CHAIN, CONTRACT)).resolves.toBe('complete' satisfies IngredientStatus);
  });

  it('maps sonar indexing to in_progress', async () => {
    const fetchImpl = mockFetch({
      [`GET https://sonar.test/v1/collections/${CHAIN}/${CONTRACT_LOWER}/status`]: () =>
        new Response(JSON.stringify({ status: 'indexing' }), { status: 200 }),
    });
    await expect(probes(fetchImpl).probeSonar(CHAIN, CONTRACT)).resolves.toBe('in_progress');
  });

  it('maps sonar 404 to pending', async () => {
    const fetchImpl = mockFetch({
      [`GET https://sonar.test/v1/collections/${CHAIN}/${CONTRACT_LOWER}/status`]: () =>
        new Response(JSON.stringify({ error: 'collection not found' }), { status: 404 }),
    });
    await expect(probes(fetchImpl).probeSonar(CHAIN, CONTRACT)).resolves.toBe('pending');
  });

  it('maps sonar failed to blocked', async () => {
    const fetchImpl = mockFetch({
      [`GET https://sonar.test/v1/collections/${CHAIN}/${CONTRACT_LOWER}/status`]: () =>
        new Response(JSON.stringify({ status: 'failed' }), { status: 200 }),
    });
    await expect(probes(fetchImpl).probeSonar(CHAIN, CONTRACT)).resolves.toBe('blocked');
  });

  it('maps score lookup 200 to complete and 404 to pending', async () => {
    const lookupUrl = `https://score.test/v1/communities/lookup?chain_id=${CHAIN}&contract_address=${CONTRACT_LOWER}`;
    const fetchImpl = mockFetch({
      [`GET ${lookupUrl}`]: () =>
        new Response(JSON.stringify({ registered: true, world_slug: 'azuki' }), { status: 200 }),
    });
    await expect(probes(fetchImpl).probeScore(CHAIN, CONTRACT)).resolves.toBe('complete');

    const fetch404 = mockFetch({
      [`GET ${lookupUrl}`]: () => new Response('', { status: 404 }),
    });
    await expect(probes(fetch404).probeScore(CHAIN, CONTRACT)).resolves.toBe('pending');
  });

  it('maps worlds lookup with world_slug', async () => {
    const lookupUrl = `https://worlds.test/v1/worlds/lookup?chain_id=${CHAIN}&contract_address=${CONTRACT_LOWER}`;
    const fetchImpl = mockFetch({
      [`GET ${lookupUrl}`]: () =>
        new Response(JSON.stringify({ world_slug: 'azuki', display_name: 'Azuki' }), { status: 200 }),
    });
    await expect(probes(fetchImpl).probeWorlds(CHAIN, CONTRACT)).resolves.toEqual({
      status: 'complete',
      world_slug: 'azuki',
    });
  });

  it('POST enqueue sonar ingest on 202', async () => {
    const ingestUrl = `https://sonar.test/v1/collections/${CHAIN}/${CONTRACT_LOWER}/ingest`;
    const fetchImpl = mockFetch({
      [`POST ${ingestUrl}`]: async (req) => {
        expect(req.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
        const body = await req.json();
        expect(body).toMatchObject({ order_id: 'ord_1', source: 'ordering-service' });
        return new Response(JSON.stringify({ status: 'queued' }), { status: 202 });
      },
    });
    const ok = await probes(fetchImpl).enqueueSonar({
      orderId: 'ord_1',
      chainId: CHAIN,
      contractAddress: CONTRACT,
      displayName: 'Azuki',
      contactEmail: 'test@example.com',
      source: 'ordering-service',
    });
    expect(ok).toBe(true);
  });
});
