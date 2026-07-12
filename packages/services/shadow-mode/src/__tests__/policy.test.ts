import { describe, it, expect } from 'vitest';
import { StaticProducerPolicy } from '../adapters/static-producer-policy.js';
import { AllowAllPolicy } from '../adapters/allow-all-policy.js';

describe('AC-9 StaticProducerPolicy is fail-closed', () => {
  const policy = new StaticProducerPolicy();

  it('rejects a non-identity source emitting identity.wallet.linked', async () => {
    const r = policy.verifyProducer({ source: 'discord', name: 'identity.wallet.linked.v1', communityId: 'demo' });
    expect(r).toEqual({ ok: false, reason: 'unauthorized_source' });
  });

  it('rejects a non-identity source emitting identity.link.revoked', async () => {
    const r = policy.verifyProducer({ source: 'sonar', name: 'identity.link.revoked.v1', communityId: 'demo' });
    expect(r.ok).toBe(false);
  });

  it('allows identity_api to emit identity.wallet.linked', async () => {
    expect(policy.verifyProducer({ source: 'identity_api', name: 'identity.wallet.linked.v1', communityId: 'demo' }).ok).toBe(true);
  });

  it('allows discord to emit discord.member.snapshot', async () => {
    expect(policy.verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'demo' }).ok).toBe(true);
  });

  it('rejects discord emitting sonar.wallet.attributed (wrong source for event)', async () => {
    expect(policy.verifyProducer({ source: 'discord', name: 'sonar.wallet.attributed.v1', communityId: 'demo' }).ok).toBe(false);
  });

  it('rejects cross-community when the producer declares a scope', async () => {
    const r = policy.verifyProducer({
      source: 'identity_api',
      name: 'identity.wallet.linked.v1',
      communityId: 'demo',
      producer: { service: 'identity-api', communities: ['other'] },
    });
    expect(r).toEqual({ ok: false, reason: 'cross_community' });
  });
});

describe('AllowAllPolicy is a guarded test double', () => {
  it('constructs under NODE_ENV=test (vitest) and allows all', async () => {
    expect(new AllowAllPolicy().verifyProducer({ source: 'discord', name: 'discord.member.snapshot.v1', communityId: 'demo' } as never).ok).toBe(true);
  });

  it('refuses to construct outside NODE_ENV=test', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new AllowAllPolicy()).toThrow(/test double/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
