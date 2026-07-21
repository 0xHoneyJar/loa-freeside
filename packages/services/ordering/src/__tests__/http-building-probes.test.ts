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

describe('probeShadow — shadow-audit capability probe (FR-2)', () => {
  const CHAIN = '1';
  const CONTRACT = '0xED5AF388653567Af2F388e6224DcC93746104133';
  const CONTRACT_LOWER = CONTRACT.toLowerCase();

  function shadowProbes(status: number) {
    const url = `https://shadow.test/v1/collections/1/${CONTRACT_LOWER}`;
    const fetchImpl = mockFetch({ [`GET ${url}`]: () => new Response(JSON.stringify({ collection: 'azuki', standard: 'erc721' }), { status }) });
    return new HttpBuildingProbes({ sonarApiUrl: 'https://s.test', scoreApiUrl: 'https://sc.test', worldsApiUrl: 'https://w.test', serviceToken: 'tok', shadowAuditApiUrl: 'https://shadow.test', fetchImpl });
  }

  it('200 → complete (audit can cover this collection)', async () => {
    expect(await shadowProbes(200).probeShadow(CHAIN, CONTRACT)).toBe('complete');
  });
  it('404 → pending (not auditable here)', async () => {
    expect(await shadowProbes(404).probeShadow(CHAIN, CONTRACT)).toBe('pending');
  });
  it('5xx → blocked', async () => {
    expect(await shadowProbes(503).probeShadow(CHAIN, CONTRACT)).toBe('blocked');
  });
  it('200 with a malformed body → blocked (never trust a bare 200)', async () => {
    const url = `https://shadow.test/v1/collections/1/${CONTRACT_LOWER}`;
    const fetchImpl = mockFetch({ [`GET ${url}`]: () => new Response('not json', { status: 200 }) });
    const probes = new HttpBuildingProbes({ sonarApiUrl: 'https://s.test', scoreApiUrl: 'https://sc.test', worldsApiUrl: 'https://w.test', serviceToken: 'tok', shadowAuditApiUrl: 'https://shadow.test', fetchImpl });
    expect(await probes.probeShadow(CHAIN, CONTRACT)).toBe('blocked');
  });

  it('no shadowAuditApiUrl → blocked (leaves shadow on the policy path)', async () => {
    const probes = new HttpBuildingProbes({ sonarApiUrl: 'https://s.test', scoreApiUrl: 'https://sc.test', worldsApiUrl: 'https://w.test', serviceToken: 'tok', fetchImpl: mockFetch({}) });
    expect(probes.hasShadowProbe).toBe(false);
    expect(await probes.probeShadow(CHAIN, CONTRACT)).toBe('blocked');
  });
});

describe('probeMetadataSnapshot — score-api metadata-snapshot status (T-3)', () => {
  const SNAPSHOT_URL = `https://score.test/v1/communities/metadata-snapshot?chain_id=${CHAIN}&contract_address=${CONTRACT_LOWER}`;

  function makeProbe(responseFactory: () => Response): HttpBuildingProbes {
    return new HttpBuildingProbes({
      sonarApiUrl: 'https://sonar.test',
      scoreApiUrl: 'https://score.test',
      worldsApiUrl: 'https://worlds.test',
      serviceToken: TOKEN,
      fetchImpl: mockFetch({ [`GET ${SNAPSHOT_URL}`]: responseFactory }),
    });
  }

  it('200 { status: complete } → complete', async () => {
    expect(await makeProbe(() => new Response(JSON.stringify({ status: 'complete' }), { status: 200 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('complete');
  });

  it('200 { status: in_progress } → in_progress', async () => {
    expect(await makeProbe(() => new Response(JSON.stringify({ status: 'in_progress' }), { status: 200 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('in_progress');
  });

  it('200 { status: unknown_value } → pending (unknown body status falls back)', async () => {
    expect(await makeProbe(() => new Response(JSON.stringify({ status: 'queued' }), { status: 200 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('pending');
  });

  it('200 malformed body → pending (missing status key)', async () => {
    expect(await makeProbe(() => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('pending');
  });

  it('404 → pending (snapshot not yet triggered)', async () => {
    expect(await makeProbe(() => new Response('', { status: 404 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('pending');
  });

  it('503 → blocked (upstream error)', async () => {
    expect(await makeProbe(() => new Response('', { status: 503 })).probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('blocked');
  });

  it('network error → blocked', async () => {
    const p = new HttpBuildingProbes({
      sonarApiUrl: 'https://sonar.test',
      scoreApiUrl: 'https://score.test',
      worldsApiUrl: 'https://worlds.test',
      serviceToken: TOKEN,
      fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch,
    });
    expect(await p.probeMetadataSnapshot(CHAIN, CONTRACT)).toBe('blocked');
  });
});

describe('snapshotMetadata — dispatch POST with Idempotency-Key (T-3)', () => {
  const DISPATCH_URL = 'https://score.test/v1/communities/metadata-snapshot';

  it('sends Idempotency-Key: <orderId>:metadata_snapshot', async () => {
    let capturedIdempotencyKey: string | null = null;
    const fetchImpl = mockFetch({
      [`POST ${DISPATCH_URL}`]: async (req) => {
        capturedIdempotencyKey = req.headers.get('Idempotency-Key');
        return new Response('', { status: 202 });
      },
    });
    const p = new HttpBuildingProbes({ sonarApiUrl: 'https://sonar.test', scoreApiUrl: 'https://score.test', worldsApiUrl: 'https://worlds.test', serviceToken: TOKEN, fetchImpl });
    const result = await p.snapshotMetadata({ orderId: 'ord_42', chainId: CHAIN, contractAddress: CONTRACT, displayName: 'Azuki', contactEmail: 'a@b.com', source: 'ordering-service' });
    expect(result.ok).toBe(true);
    expect(capturedIdempotencyKey).toBe('ord_42:metadata_snapshot');
  });

  it('202 → ok=true, 400 → ok=false', async () => {
    const p202 = new HttpBuildingProbes({ sonarApiUrl: 'https://sonar.test', scoreApiUrl: 'https://score.test', worldsApiUrl: 'https://worlds.test', serviceToken: TOKEN, fetchImpl: mockFetch({ [`POST ${DISPATCH_URL}`]: () => new Response('', { status: 202 }) }) });
    expect((await p202.snapshotMetadata({ orderId: 'o', chainId: CHAIN, contractAddress: CONTRACT, displayName: 'd', contactEmail: 'e@e.com', source: 's' })).ok).toBe(true);

    const p400 = new HttpBuildingProbes({ sonarApiUrl: 'https://sonar.test', scoreApiUrl: 'https://score.test', worldsApiUrl: 'https://worlds.test', serviceToken: TOKEN, fetchImpl: mockFetch({ [`POST ${DISPATCH_URL}`]: () => new Response('', { status: 400 }) }) });
    expect((await p400.snapshotMetadata({ orderId: 'o', chainId: CHAIN, contractAddress: CONTRACT, displayName: 'd', contactEmail: 'e@e.com', source: 's' })).ok).toBe(false);
  });
});

describe('checkDiscordChannelHealth — discord-observer health gate (T-4)', () => {
  const HEALTH_URL = `https://discord.test/v1/channels/health?chain_id=${CHAIN}&contract_address=${CONTRACT_LOWER}`;

  function makeHealthProbe(responseFactory: () => Response): HttpBuildingProbes {
    return new HttpBuildingProbes({
      sonarApiUrl: 'https://sonar.test',
      scoreApiUrl: 'https://score.test',
      worldsApiUrl: 'https://worlds.test',
      serviceToken: TOKEN,
      discordObserverApiUrl: 'https://discord.test',
      fetchImpl: mockFetch({ [`GET ${HEALTH_URL}`]: responseFactory }),
    });
  }

  it('200 { healthy: true } → healthy=true', async () => {
    expect(await makeHealthProbe(() => new Response(JSON.stringify({ healthy: true }), { status: 200 })).checkDiscordChannelHealth(CHAIN, CONTRACT)).toEqual({ healthy: true });
  });

  it('200 { healthy: false, reason } → healthy=false with reason', async () => {
    const result = await makeHealthProbe(() => new Response(JSON.stringify({ healthy: false, reason: 'channel archived' }), { status: 200 })).checkDiscordChannelHealth(CHAIN, CONTRACT);
    expect(result).toEqual({ healthy: false, reason: 'channel archived' });
  });

  it('200 { healthy: false } without reason → healthy=false no reason key', async () => {
    const result = await makeHealthProbe(() => new Response(JSON.stringify({ healthy: false }), { status: 200 })).checkDiscordChannelHealth(CHAIN, CONTRACT);
    expect(result.healthy).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('503 → healthy=false', async () => {
    expect(await makeHealthProbe(() => new Response('', { status: 503 })).checkDiscordChannelHealth(CHAIN, CONTRACT)).toMatchObject({ healthy: false });
  });

  it('network error → { healthy: false, reason: "network error" }', async () => {
    const p = new HttpBuildingProbes({
      sonarApiUrl: 'https://sonar.test',
      scoreApiUrl: 'https://score.test',
      worldsApiUrl: 'https://worlds.test',
      serviceToken: TOKEN,
      discordObserverApiUrl: 'https://discord.test',
      fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch,
    });
    expect(await p.checkDiscordChannelHealth(CHAIN, CONTRACT)).toEqual({ healthy: false, reason: 'network error' });
  });

  it('no discordObserverApiUrl → healthy=false', async () => {
    const p = new HttpBuildingProbes({ sonarApiUrl: 'https://sonar.test', scoreApiUrl: 'https://score.test', worldsApiUrl: 'https://worlds.test', serviceToken: TOKEN, fetchImpl: mockFetch({}) });
    expect(await p.checkDiscordChannelHealth(CHAIN, CONTRACT)).toMatchObject({ healthy: false });
  });
});
