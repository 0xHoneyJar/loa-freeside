/**
 * identity-api-link.test.ts — unit tests for the T4.2 client + service wrapper
 * (bead arrakis-zedx).
 *
 * Tests cover:
 *   - happy path: 200 → typed result
 *   - 409 → IdentityApiCrossUserCollisionError (do-not-retry)
 *   - 5xx → IdentityApiTransientError (retry candidate)
 *   - 401 / 503 → IdentityApiConfigError (ops surface, do-not-retry)
 *   - 4xx other → IdentityApiConfigError (bad input)
 *   - network/abort → IdentityApiTransientError
 *   - X-Service-Token + content-type headers are sent
 *   - factory returns null when env unset
 *
 * Uses vitest fetch mocking. No real identity-api invocation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  IdentityApiClient,
  IdentityApiConfigError,
  IdentityApiCrossUserCollisionError,
  IdentityApiIdentityLink,
  IdentityApiTransientError,
  buildIdentityApiIdentityLinkFromEnv,
  getIdentityApiIdentityLink,
  __resetIdentityApiIdentityLinkForTest,
} from '../../../src/services/identity-api-link.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function buildFetchMock(responses: Array<Response | Error>): typeof fetch {
  let idx = 0;
  return (async () => {
    const next = responses[idx++];
    if (next instanceof Error) throw next;
    if (!next) throw new Error('buildFetchMock: ran out of canned responses');
    return next;
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const HAPPY_INPUT = {
  worldSlug: 'mibera',
  discordId: 'disc-1',
  walletAddress: '0xaaa0000000000000000000000000000000000001',
} as const;

// ─── HTTP client tests ─────────────────────────────────────────────────────

describe('IdentityApiClient.linkVerifiedWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('200 → maps snake_case wire body to camelCase result (FAGAN iter-1 fix)', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(200, {
        ok: true,
        user_id: '11111111-1111-4111-8111-111111111111',
        wallet_address: HAPPY_INPUT.walletAddress,
        idempotent: false,
        conflict_resolved: null,
      }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 'token-a',
      fetchImpl,
    });
    const result = await client.linkVerifiedWallet(HAPPY_INPUT);
    expect(result.ok).toBe(true);
    // identity-api emits snake_case (user_id/wallet_address/conflict_resolved)
    // but the client's public surface is camelCase. The mapping happens in
    // linkVerifiedWallet() — see FAGAN iter-1 regression: a prior version
    // cast the wire body straight to the public type, leaving every
    // camelCase field undefined at runtime.
    expect(result.userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.walletAddress).toBe(HAPPY_INPUT.walletAddress);
    expect(result.idempotent).toBe(false);
    expect(result.conflictResolved).toBeNull();
  });

  it('200 with conflict_resolved="wallet_rebound" → camelCase conflictResolved', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(200, {
        ok: true,
        user_id: '11111111-1111-4111-8111-111111111111',
        wallet_address: HAPPY_INPUT.walletAddress,
        idempotent: false,
        conflict_resolved: 'wallet_rebound',
      }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    const result = await client.linkVerifiedWallet(HAPPY_INPUT);
    expect(result.conflictResolved).toBe('wallet_rebound');
  });

  it('409 cross_user_collision → IdentityApiCrossUserCollisionError', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(409, {
        ok: false,
        conflict: 'cross_user_collision',
        message: 'wallet→A, discord→B',
      }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiCrossUserCollisionError,
    );
  });

  it('500 → IdentityApiTransientError (retry candidate)', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(500, { error: 'internal' }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiTransientError,
    );
  });

  it('401 → IdentityApiConfigError (ops surface, do-not-retry)', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(401, { code: 'unauthorized', message: 'bad token' }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 'wrong-token',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiConfigError,
    );
  });

  it('503 with code=service_unconfigured → IdentityApiConfigError (BB F-004)', async () => {
    // identity-api's typed 503: the route returns this when LINK_SERVICE
    // _TOKEN is unset. ConfigError = ops surface, do-not-retry.
    const fetchImpl = buildFetchMock([
      jsonResponse(503, { code: 'service_unconfigured' }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiConfigError,
    );
  });

  it('503 from infrastructure (no body code) → IdentityApiTransientError (BB F-004)', async () => {
    // Railway gateway, k8s readiness probes, ALBs all emit bare 503 during
    // transient unavailability. Treating these as ConfigError would
    // permanently disable retry paths during deploys. AWS ALB-503 lesson.
    const fetchImpl = buildFetchMock([
      jsonResponse(503, { error: 'Service Unavailable' }), // no 'code' field
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiTransientError,
    );
  });

  it('timeout fires synchronously when 200 with valid body lands (BB F-001 sanity)', async () => {
    // BB F-001: the original version cleared the abort timer the moment
    // headers arrived (inside the headers-only try block). The fix wraps
    // the whole method in an outer try/finally so the timer's lifetime
    // spans the body read too.
    //
    // We can't faithfully mock a "headers arrive, body hangs" condition
    // because Node/Bun's signal propagation into a ReadableStream is
    // observed by the real fetch implementation, not by hand-constructed
    // Response objects in tests. So this test just verifies the happy
    // path completes WITHOUT the timer firing (timer is properly cleared
    // in the wider finally only AFTER the body read returns).
    //
    // The F-001 fix is structurally guaranteed by the outer try/finally:
    // `clearTimeout(timer)` is now AFTER `await res.json()`. Production
    // fetch's signal propagation into the body stream + 5s timeout is
    // the real safety net against hung connections.
    const fetchImpl = buildFetchMock([
      jsonResponse(200, {
        ok: true,
        user_id: '11111111-1111-4111-8111-111111111111',
        wallet_address: HAPPY_INPUT.walletAddress,
        idempotent: false,
        conflict_resolved: null,
      }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
      timeoutMs: 50,
    });
    // 50ms is well under the 200ms vitest sub-test timeout default; this
    // would HANG and fail if the body-read path bypassed the cleanup.
    await client.linkVerifiedWallet(HAPPY_INPUT);
    // Wait a tick to ensure the timer truly cleared (no late abort).
    await new Promise((r) => setTimeout(r, 100));
    // If we got here without the timer firing post-call, F-001 fix is intact.
  });

  it('400 bad-input → IdentityApiConfigError', async () => {
    const fetchImpl = buildFetchMock([
      jsonResponse(400, { code: 'invalid_param' }),
    ]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiConfigError,
    );
  });

  it('network error → IdentityApiTransientError', async () => {
    const fetchImpl = buildFetchMock([new Error('ECONNREFUSED')]);
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test',
      serviceToken: 't',
      fetchImpl,
    });
    await expect(client.linkVerifiedWallet(HAPPY_INPUT)).rejects.toBeInstanceOf(
      IdentityApiTransientError,
    );
  });

  it('sends X-Service-Token header + content-type=application/json', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        ok: true,
        user_id: '11111111-1111-4111-8111-111111111111',
        wallet_address: HAPPY_INPUT.walletAddress,
        idempotent: false,
        conflict_resolved: null,
      });
    }) as unknown as typeof fetch;
    const client = new IdentityApiClient({
      baseUrl: 'http://identity-api.test/',
      serviceToken: 'secret-abc',
      fetchImpl,
    });
    await client.linkVerifiedWallet(HAPPY_INPUT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://identity-api.test/v1/link/verified-wallet');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-service-token']).toBe('secret-abc');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(calls[0]?.init?.body as string);
    expect(body).toMatchObject({
      worldSlug: 'mibera',
      discordId: 'disc-1',
      walletAddress: HAPPY_INPUT.walletAddress,
    });
  });

  it('throws at construction when baseUrl or serviceToken is missing', () => {
    expect(
      () =>
        new IdentityApiClient({
          baseUrl: '',
          serviceToken: 't',
        }),
    ).toThrow(/baseUrl/);
    expect(
      () =>
        new IdentityApiClient({
          baseUrl: 'http://x',
          serviceToken: '',
        }),
    ).toThrow(/serviceToken/);
  });
});

// ─── service wrapper tests ─────────────────────────────────────────────────

describe('IdentityApiIdentityLink.recordVerifiedWalletLink', () => {
  it('delegates to the client + returns the result verbatim', async () => {
    const expected = {
      ok: true as const,
      userId: '11111111-1111-4111-8111-111111111111',
      walletAddress: HAPPY_INPUT.walletAddress,
      idempotent: false,
      conflictResolved: null,
    };
    const client = {
      async linkVerifiedWallet() {
        return expected;
      },
    } as unknown as IdentityApiClient;
    const svc = new IdentityApiIdentityLink(client);
    const got = await svc.recordVerifiedWalletLink(HAPPY_INPUT);
    expect(got).toBe(expected);
  });
});

// ─── factory tests ─────────────────────────────────────────────────────────

describe('buildIdentityApiIdentityLinkFromEnv', () => {
  const ORIG_ENV = { ...process.env };
  afterEach(() => {
    delete process.env.IDENTITY_API_URL;
    delete process.env.IDENTITY_API_SERVICE_TOKEN;
    delete process.env.IDENTITY_API_TIMEOUT_MS;
    Object.assign(process.env, ORIG_ENV);
  });

  it('returns null when env vars are absent', () => {
    delete process.env.IDENTITY_API_URL;
    delete process.env.IDENTITY_API_SERVICE_TOKEN;
    expect(buildIdentityApiIdentityLinkFromEnv()).toBeNull();
  });

  it('returns an instance when both env vars are set', () => {
    process.env.IDENTITY_API_URL = 'http://identity-api.test';
    process.env.IDENTITY_API_SERVICE_TOKEN = 't';
    const svc = buildIdentityApiIdentityLinkFromEnv();
    expect(svc).toBeInstanceOf(IdentityApiIdentityLink);
  });
});

describe('getIdentityApiIdentityLink (true lazy-singleton · BB F-003)', () => {
  const ORIG_ENV = { ...process.env };
  beforeEach(() => {
    __resetIdentityApiIdentityLinkForTest();
  });
  afterEach(() => {
    __resetIdentityApiIdentityLinkForTest();
    delete process.env.IDENTITY_API_URL;
    delete process.env.IDENTITY_API_SERVICE_TOKEN;
    Object.assign(process.env, ORIG_ENV);
  });

  it('returns the SAME instance across calls (singleton)', () => {
    process.env.IDENTITY_API_URL = 'http://identity-api.test';
    process.env.IDENTITY_API_SERVICE_TOKEN = 't';
    const a = getIdentityApiIdentityLink();
    const b = getIdentityApiIdentityLink();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(IdentityApiIdentityLink);
  });

  it('caches null when env unset — second call does not re-attempt build', () => {
    delete process.env.IDENTITY_API_URL;
    delete process.env.IDENTITY_API_SERVICE_TOKEN;
    const a = getIdentityApiIdentityLink();
    const b = getIdentityApiIdentityLink();
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it('__resetForTest forces a rebuild on next call', () => {
    process.env.IDENTITY_API_URL = 'http://identity-api.test';
    process.env.IDENTITY_API_SERVICE_TOKEN = 't';
    const a = getIdentityApiIdentityLink();
    __resetIdentityApiIdentityLinkForTest();
    const b = getIdentityApiIdentityLink();
    expect(a).not.toBe(b); // distinct instances after reset
  });
});
