import { describe, it, expect } from 'vitest';
import {
  ShadowEventSchema,
  walletAlias,
  discordAlias,
  identityAlias,
  type ShadowEvent,
} from '../index.js';

const NOW = '2026-06-26T00:00:00.000Z';

function discordSnapshot(): ShadowEvent {
  return {
    event_id: 'evt-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'discord.member.snapshot.v1',
    source: 'discord',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    payload: { discord_user_id: '1001', display_name: 'alice', role_ids: ['role-holder'] },
  };
}

describe('ShadowEventSchema', () => {
  it('parses a valid discord member snapshot', () => {
    const parsed = ShadowEventSchema.parse(discordSnapshot());
    expect(parsed.name).toBe('discord.member.snapshot.v1');
  });

  it('parses an identity.link.revoked.v1 event (FR-13)', () => {
    const ev = {
      event_id: 'evt-revoke-1',
      schema_version: 'shadow.event.v1',
      community_id: 'demo',
      name: 'identity.link.revoked.v1',
      source: 'identity_api',
      truth_status: 'attested',
      observed_at: NOW,
      emitted_at: NOW,
      payload: { user_id: 'usr_alice', link_kind: 'wallet' },
    };
    expect(ShadowEventSchema.parse(ev).name).toBe('identity.link.revoked.v1');
  });

  it('rejects an unexpected top-level key (.strict seals the envelope)', () => {
    const bad = { ...discordSnapshot(), smuggled: true } as unknown;
    expect(ShadowEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unexpected payload key (.strict seals the payload)', () => {
    const ev = discordSnapshot();
    const bad = { ...ev, payload: { ...(ev.payload as object), evil: 1 } } as unknown;
    expect(ShadowEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown event name', () => {
    const bad = { ...discordSnapshot(), name: 'discord.member.deleted.v1' } as unknown;
    expect(ShadowEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-identity source is NOT a schema concern (policy enforces it) — schema accepts source enum', () => {
    // Schema validates SHAPE; authorization (only identity_api emits identity.*) is the policy's job (AC-9).
    const ev = { ...discordSnapshot(), name: 'identity.wallet.linked.v1', source: 'discord',
      payload: { user_id: 'u', wallet: { chain: 'berachain', address: '0xabc' } } } as unknown;
    expect(ShadowEventSchema.safeParse(ev).success).toBe(true);
  });
});

describe('alias helpers', () => {
  it('walletAlias lowercases chain and address for canonical matching', () => {
    expect(walletAlias({ chain: 'Berachain', address: '0xAbC' })).toBe('wallet:berachain:0xabc');
  });
  it('discord/identity aliases are namespaced', () => {
    expect(discordAlias('1001')).toBe('discord:1001');
    expect(identityAlias('usr_alice')).toBe('identity:usr_alice');
  });
});
