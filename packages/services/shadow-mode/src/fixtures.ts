/**
 * Demo fixtures (ported from the handoff `fixtures.ts`). A deterministic
 * community ("demo") exercising: config → discord alice → identity links
 * (account + wallet, the verified merge path) → sonar attribution → incumbent
 * role → freeside computed role (divergence), plus a wallet-only "bob".
 */

import type { ShadowEvent } from '@freeside/shadow-mode-protocol';

const NOW = '2026-06-26T00:00:00.000Z';

export const demoEvents: ShadowEvent[] = [
  {
    event_id: 'evt-demo-config-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'community.config.updated.v1',
    source: 'manual_config',
    truth_status: 'attested',
    observed_at: NOW,
    emitted_at: NOW,
    payload: {
      role_rank: { 'role-holder': 1, 'role-core': 2 },
      watched_contracts: ['0xpythenians'],
      incumbent_bot_ids: ['collabland'],
    },
  },
  {
    event_id: 'evt-discord-alice-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'discord.member.snapshot.v1',
    source: 'discord',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    payload: { discord_user_id: '1001', display_name: 'alice', role_ids: ['role-holder'] },
  },
  {
    event_id: 'evt-identity-alice-discord-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'identity.account.linked.v1',
    source: 'identity_api',
    truth_status: 'attested',
    observed_at: NOW,
    emitted_at: NOW,
    payload: {
      user_id: 'usr_alice',
      account_kind: 'discord',
      external_id: '1001',
      proof_ref: 'identity-api:/links/usr_alice/discord/1001',
    },
  },
  {
    event_id: 'evt-identity-alice-wallet-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'identity.wallet.linked.v1',
    source: 'identity_api',
    truth_status: 'attested',
    observed_at: NOW,
    emitted_at: NOW,
    payload: {
      user_id: 'usr_alice',
      wallet: { chain: 'berachain', address: '0xaaa0000000000000000000000000000000000001' },
      proof_ref: 'identity-api:/links/usr_alice/wallet/0xaaa',
    },
  },
  {
    event_id: 'evt-sonar-alice-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'sonar.wallet.attributed.v1',
    source: 'sonar',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    evidence_ref: 'sonar:tx/0xabc',
    payload: {
      wallet: { chain: 'berachain', address: '0xaaa0000000000000000000000000000000000001' },
      contract_address: '0xpythenians',
      edge_kind: 'held_at_snapshot',
      token_id: '7',
      tx_hash: '0xabc',
      block_number: 123,
    },
  },
  {
    event_id: 'evt-incumbent-alice-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'incumbent.role.observed.v1',
    source: 'incumbent_bot',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    payload: { discord_user_id: '1001', incumbent: 'collab.land', role_ids: ['role-holder'] },
  },
  {
    event_id: 'evt-freeside-alice-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'freeside.role.computed.v1',
    source: 'freeside',
    truth_status: 'inferred',
    observed_at: NOW,
    emitted_at: NOW,
    payload: {
      locator: { user_id: 'usr_alice' },
      role_ids: ['role-core'],
      reason: 'Verified wallet holds watched NFT and meets core rule.',
    },
  },
  {
    event_id: 'evt-sonar-wallet-only-1',
    schema_version: 'shadow.event.v1',
    community_id: 'demo',
    name: 'sonar.wallet.attributed.v1',
    source: 'sonar',
    truth_status: 'observed',
    observed_at: NOW,
    emitted_at: NOW,
    evidence_ref: 'sonar:tx/0xdef',
    payload: {
      wallet: { chain: 'berachain', address: '0xbbb0000000000000000000000000000000000002' },
      contract_address: '0xpythenians',
      edge_kind: 'minted',
      token_id: '42',
      tx_hash: '0xdef',
      block_number: 124,
    },
  },
];
