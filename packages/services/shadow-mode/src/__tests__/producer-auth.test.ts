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
