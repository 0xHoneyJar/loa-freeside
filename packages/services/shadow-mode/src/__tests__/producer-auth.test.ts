import { describe, expect, it, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { JwtProducerPolicy, PRODUCER_AUDIENCE } from '../auth/jwt-producer-policy.js';
import { AppendGrant, GrantError, assertGrant, testGrant } from '../auth/append-grant.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import type { ShadowObservation } from '@freeside/shadow-mode-protocol';
import type { KeyObject } from 'node:crypto';

const ISSUER = 'https://svc.test';
const KID = 'k1';

let privateKey: KeyObject;
let jwks: { keys: unknown[] };

async function mint(claims: Record<string, unknown>, opts: { alg?: string; exp?: string; aud?: string; key?: KeyObject } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? PRODUCER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  // jose returns KeyObject on Node
  privateKey = kp.privateKey as unknown as KeyObject;
  const jwk = await exportJWK(kp.publicKey);
  jwks = { keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig' }] };
});

describe('JwtProducerPolicy → AppendGrant', () => {
  function policy() {
    return new JwtProducerPolicy({ issuer: ISSUER, jwks });
  }

  it('valid token mints a scoped grant', async () => {
    const token = await mint({ producer_id: 'discord-bot', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] });
    const grant = await policy().authorize(token);
    expect(grant).toBeInstanceOf(AppendGrant);
    expect(grant.producerId).toBe('discord-bot');
    expect(grant.allows('discord', 'discord.member.snapshot.v1')).toBe(true);
    expect(grant.allows('sonar', 'sonar.wallet.attributed.v1')).toBe(false);
  });

  it('rejects alg=none (algorithm confusion)', async () => {
    // Hand-craft an unsigned alg:none token.
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: ISSUER, aud: PRODUCER_AUDIENCE, producer_id: 'x', sources: ['discord'], event_names: ['discord.member.snapshot.v1'], exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    await expect(policy().authorize(`${header}.${body}.`)).rejects.toThrow(GrantError);
  });

  it('rejects HS256 (public key as secret confusion)', async () => {
    const { SignJWT: S } = await import('jose');
    const jwkPub = jwks.keys[0] as { x: string; y: string };
    const secret = new TextEncoder().encode(JSON.stringify(jwkPub));
    const hsToken = await new S({ producer_id: 'x', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(PRODUCER_AUDIENCE)
      .setExpirationTime('10m')
      .sign(secret);
    await expect(policy().authorize(hsToken)).rejects.toThrow(GrantError);
  });

  it('rejects an expired token', async () => {
    const token = await mint({ producer_id: 'x', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] }, { exp: '-1m' });
    await expect(policy().authorize(token)).rejects.toThrow(GrantError);
  });

  it('rejects wrong audience', async () => {
    const token = await mint({ producer_id: 'x', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] }, { aud: 'someone-else' });
    await expect(policy().authorize(token)).rejects.toThrow(GrantError);
  });

  it('rejects a token whose lifetime exceeds 1h (exp - iat)', async () => {
    // 2h token — passes signature/aud but the exp-iat bound rejects it.
    const token = await mint({ producer_id: 'x', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] }, { exp: '2h' });
    await expect(policy().authorize(token)).rejects.toThrow(/lifetime|1h/);
  });

  it('rejects malformed claims', async () => {
    const token = await mint({ producer_id: 'x' }); // missing sources/event_names
    await expect(policy().authorize(token)).rejects.toThrow(/claims shape/);
  });
});

describe('AppendGrant boundary (capability, not data)', () => {
  const obs: ShadowObservation = {
    event_id: 'e1',
    community_id: 'demo',
    name: 'discord.member.snapshot.v1' as ShadowObservation['name'],
    source: 'discord' as ShadowObservation['source'],
    truth_status: 'observed' as ShadowObservation['truth_status'],
    observed_at: '2026-07-03T00:00:00.000Z',
    emitted_at: '2026-07-03T00:00:00.000Z',
    payload: {},
    ingested_at: '2026-07-03T00:00:01.000Z',
  };

  it('a forged plain-object "grant" is rejected at the store boundary', async () => {
    const store = new InMemoryLedgerStore();
    const forged = { producerId: 'x', sources: ['discord'], eventNames: ['discord.member.snapshot.v1'], allows: () => true } as unknown as AppendGrant;
    await expect(store.appendObservationIfAbsent(obs, forged)).rejects.toThrow(GrantError);
  });

  it('an out-of-scope grant is rejected', () => {
    const grant = testGrant(['sonar'], ['sonar.wallet.attributed.v1']);
    expect(() => assertGrant(grant, 'discord', 'discord.member.snapshot.v1')).toThrow(/not scoped/);
  });

  it('a properly scoped grant passes', () => {
    const grant = testGrant(['discord'], ['discord.member.snapshot.v1']);
    expect(() => assertGrant(grant, 'discord', 'discord.member.snapshot.v1')).not.toThrow();
  });
});

describe('SvcJwtProducerPolicy (deployed HTTP auth cannot be bypassed)', () => {
  it('no bearer token → no_token (never mints a grant)', async () => {
    const { SvcJwtProducerPolicy } = await import('../adapters/svc-jwt-policy.js');
    const policy = new SvcJwtProducerPolicy(new JwtProducerPolicy({ issuer: ISSUER, jwks }));
    const r = await policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'demo' } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_token');
  });

  it('valid token → grant scoped to the event', async () => {
    const { SvcJwtProducerPolicy } = await import('../adapters/svc-jwt-policy.js');
    const policy = new SvcJwtProducerPolicy(new JwtProducerPolicy({ issuer: ISSUER, jwks }));
    const token = await mint({ producer_id: 'discord-bot', sources: ['discord'], event_names: ['discord.member.snapshot.v1'] });
    const r = await policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'demo', bearerToken: token } as never);
    expect(r.ok).toBe(true);
  });

  it('token scoped to a DIFFERENT event → unauthorized_source', async () => {
    const { SvcJwtProducerPolicy } = await import('../adapters/svc-jwt-policy.js');
    const policy = new SvcJwtProducerPolicy(new JwtProducerPolicy({ issuer: ISSUER, jwks }));
    const token = await mint({ producer_id: 'sonar', sources: ['sonar'], event_names: ['sonar.wallet.attributed.v1'] });
    const r = await policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'demo', bearerToken: token } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unauthorized_source');
  });
});

describe('AppendGrant is unforgeable (FAGAN S2 critical)', () => {
  it('AppendGrant has no public mint and cannot be constructed externally', async () => {
    const mod = await import('../auth/append-grant.js');
    expect((mod.AppendGrant as unknown as { _mint?: unknown })._mint).toBeUndefined();
    // Direct construction with a fake token is rejected.
    expect(() => new (mod.AppendGrant as unknown as new (...a: unknown[]) => unknown)(Symbol('fake'), 'x', ['*'], ['*'])).toThrow();
    // Package index does not export mintGrant.
    const idx = await import('../index.js');
    expect((idx as Record<string, unknown>).mintGrant).toBeUndefined();
    expect((idx as Record<string, unknown>).operatorMigrationGrant).toBeUndefined();
  });

  it('a JWT with communities claim binds cross-community appends', async () => {
    const { SvcJwtProducerPolicy } = await import('../adapters/svc-jwt-policy.js');
    const policy = new SvcJwtProducerPolicy(new JwtProducerPolicy({ issuer: ISSUER, jwks }));
    const token = await mint({ producer_id: 'p', sources: ['discord'], event_names: ['discord.member.snapshot.v1'], communities: ['azuki'] });
    const ok = await policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'azuki', bearerToken: token } as never);
    expect(ok.ok).toBe(true);
    const bad = await policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'mibera', bearerToken: token } as never);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('cross_community');
  });

  it('producerPolicyFromEnv refuses to run structural-only when deployed', async () => {
    const { producerPolicyFromEnv } = await import('../adapters/svc-jwt-policy.js');
    expect(() => producerPolicyFromEnv({} as NodeJS.ProcessEnv)).toThrow(/producer-auth not configured/);
    // Explicit opt-in is the ONLY way to structural-only.
    const { StaticProducerPolicy } = await import('../adapters/static-producer-policy.js');
    expect(producerPolicyFromEnv({ SHADOW_MODE_ALLOW_STRUCTURAL_POLICY: '1' } as NodeJS.ProcessEnv)).toBeInstanceOf(StaticProducerPolicy);
  });
})
