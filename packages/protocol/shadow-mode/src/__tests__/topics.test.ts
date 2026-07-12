import { describe, it, expect } from 'vitest';
import { buildTopic, SHADOW_EVENT_TOPICS } from '../index.js';

describe('shadow event topics (hounfour 3-segment)', () => {
  it('builds all 8 subjects to their expected strings', () => {
    expect(SHADOW_EVENT_TOPICS).toEqual({
      discordMemberSnapshot: 'discord.member.snapshot.v1',
      identityWalletLinked: 'identity.wallet.linked.v1',
      identityAccountLinked: 'identity.account.linked.v1',
      identityLinkRevoked: 'identity.link.revoked.v1',
      sonarWalletAttributed: 'sonar.wallet.attributed.v1',
      incumbentRoleObserved: 'incumbent.role.observed.v1',
      freesideRoleComputed: 'freeside.role.computed.v1',
      communityConfigUpdated: 'community.config.updated.v1',
    });
  });

  it('rejects an uppercase segment', () => {
    expect(() => buildTopic({ aggregate: 'Discord', noun: 'member', verb: 'snapshot', version: 1 })).toThrow();
  });

  it('rejects a non-positive version', () => {
    expect(() => buildTopic({ aggregate: 'discord', noun: 'member', verb: 'snapshot', version: 0 })).toThrow();
  });
});
