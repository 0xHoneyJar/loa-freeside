import { describe, it, expect } from 'vitest';
import {
  verifyAssociation,
  InMemoryNonceStore,
  type AssociationVerifierDeps,
  type AuthExpectations,
  type AuthRequest,
  type SignedAuthMessage,
} from '../association-verifier.js';

const OWNER = '0x' + 'a'.repeat(40);
const CONTRACT = '0x' + 'b'.repeat(40);

function message(over: Partial<SignedAuthMessage> = {}): SignedAuthMessage {
  return {
    nonce: 'nonce-12345678',
    issued_at: 1000,
    expiry: 2000,
    domain: 'audit.thj',
    chain_id: 1,
    contract: CONTRACT,
    community_id: 'thj',
    scope: 'named-output',
    ...over,
  };
}
function expected(over: Partial<AuthExpectations> = {}): AuthExpectations {
  return { domain: 'audit.thj', chainId: 1, contract: CONTRACT, communityId: 'thj', nowUnixSeconds: 1500, ...over };
}
function deps(over: Partial<AssociationVerifierDeps> = {}): AssociationVerifierDeps {
  return {
    recover: async () => OWNER,
    nonces: new InMemoryNonceStore(),
    isCommunityOwner: async () => true,
    ...over,
  };
}
function request(over: Partial<AuthRequest> = {}): AuthRequest {
  return { message: message(), signature: '0xsig', ownerWallet: OWNER, ...over };
}

describe('verifyAssociation (AC-4)', () => {
  it('accepts a valid, community-bound signature', async () => {
    const r = await verifyAssociation(request(), expected(), deps());
    expect(r).toEqual({ ok: true, wallet: OWNER.toLowerCase() });
  });

  it('rejects a replayed nonce (consume-once)', async () => {
    const d = deps();
    const first = await verifyAssociation(request(), expected(), d);
    const second = await verifyAssociation(request(), expected(), d);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('replay');
  });

  it('does NOT burn the nonce on an invalid signature', async () => {
    const d = deps({
      recover: async ({ signature }) => {
        if (signature !== '0xgood') throw new Error('bad sig');
        return OWNER;
      },
    });
    const bad = await verifyAssociation(request({ signature: '0xbad' }), expected(), d);
    expect(bad.ok).toBe(false);
    const good = await verifyAssociation(request({ signature: '0xgood' }), expected(), d);
    expect(good.ok).toBe(true); // same nonce still usable — invalid attempt didn't consume it
  });

  it('rejects a domain mismatch (field binding)', async () => {
    const r = await verifyAssociation(request(), expected({ domain: 'evil.site' }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('domain');
  });

  it('rejects a contract mismatch', async () => {
    const r = await verifyAssociation(request(), expected({ contract: '0x' + 'c'.repeat(40) }), deps());
    expect(r.ok).toBe(false);
  });

  it('rejects an expired authorization', async () => {
    const r = await verifyAssociation(request(), expected({ nowUnixSeconds: 3000 }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('expired');
  });

  it('rejects when the signature recovers to a different wallet', async () => {
    const r = await verifyAssociation(request(), expected(), deps({ recover: async () => '0x' + 'd'.repeat(40) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('owner_wallet');
  });

  it('rejects a wallet not bound to the community (bare signature insufficient)', async () => {
    const r = await verifyAssociation(request(), expected(), deps({ isCommunityOwner: async () => false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('community');
  });
});
