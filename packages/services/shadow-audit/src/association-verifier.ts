/**
 * SDD §6 + §11 (SKP-001/002) — AssociationVerifier (AC-4).
 *
 * Gates named/member-level output. Named output requires an EIP-191 signature
 * from `owner_wallet` over a message that BINDS {nonce, issued_at, expiry,
 * domain, chain_id, contract, community_id, scope}; the server consumes the
 * nonce (replay rejected) and confirms the wallet is bound to the community.
 * A bare signature is insufficient. EIP-191 recovery is injected (viem at the
 * edge) so the binding/replay logic here is verifiable in isolation.
 */

import { z } from 'zod';

export const SignedAuthMessageSchema = z
  .object({
    nonce: z.string().min(8),
    issued_at: z.number().int(),
    expiry: z.number().int(),
    domain: z.string().min(1),
    chain_id: z.number().int(),
    contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    community_id: z.string().min(1),
    scope: z.string().min(1),
  })
  .strict();
export type SignedAuthMessage = z.infer<typeof SignedAuthMessageSchema>;

export interface AuthRequest {
  message: SignedAuthMessage;
  /** 0x-prefixed EIP-191 personal_sign signature. */
  signature: string;
  /** The wallet the caller claims signed. */
  ownerWallet: string;
}

export interface AuthExpectations {
  domain: string;
  chainId: number;
  contract: string;
  communityId: string;
  nowUnixSeconds: number;
}

/** Recover the EIP-191 personal_sign signer. Injected (viem at the edge). */
export type RecoverSigner = (args: { message: string; signature: string }) => Promise<string>;

/** Consume-once nonce store (bounded replay cache). */
export interface NonceStore {
  /** True if the nonce was fresh (now consumed); false if already used. */
  consume(nonce: string): Promise<boolean>;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly used = new Set<string>();
  constructor(private readonly max = 100_000) {}
  async consume(nonce: string): Promise<boolean> {
    if (this.used.has(nonce)) return false;
    if (this.used.size >= this.max) this.used.clear(); // simple bound
    this.used.add(nonce);
    return true;
  }
}

/** Does this wallet own/control the community? (contract owner()/deployer or a
 *  registered owner). Injected at the edge. */
export type CommunityOwnerCheck = (args: {
  wallet: string;
  communityId: string;
}) => Promise<boolean>;

export type AuthResult = { ok: true; wallet: string } | { ok: false; reason: string };

/** Deterministic canonical message the client signs (binds every field). */
export function canonicalAuthMessage(m: SignedAuthMessage): string {
  return [
    'Shadow Access Audit — named output authorization',
    `nonce: ${m.nonce}`,
    `issued_at: ${m.issued_at}`,
    `expiry: ${m.expiry}`,
    `domain: ${m.domain}`,
    `chain_id: ${m.chain_id}`,
    `contract: ${m.contract.toLowerCase()}`,
    `community_id: ${m.community_id}`,
    `scope: ${m.scope}`,
  ].join('\n');
}

export interface AssociationVerifierDeps {
  recover: RecoverSigner;
  nonces: NonceStore;
  isCommunityOwner: CommunityOwnerCheck;
}

/**
 * Verify a named-output authorization. The nonce is consumed only AFTER the
 * signature is validated, so invalid signatures cannot burn the nonce space.
 */
export async function verifyAssociation(
  req: AuthRequest,
  expected: AuthExpectations,
  deps: AssociationVerifierDeps,
): Promise<AuthResult> {
  const m = req.message;

  // 1. Field binding — the signed fields must match what the server expects.
  if (m.domain !== expected.domain) return { ok: false, reason: 'domain mismatch' };
  if (m.chain_id !== expected.chainId) return { ok: false, reason: 'chain_id mismatch' };
  if (m.contract.toLowerCase() !== expected.contract.toLowerCase()) {
    return { ok: false, reason: 'contract mismatch' };
  }
  if (m.community_id !== expected.communityId) return { ok: false, reason: 'community mismatch' };

  // 2. Freshness window.
  if (!(m.issued_at <= expected.nowUnixSeconds && expected.nowUnixSeconds <= m.expiry)) {
    return { ok: false, reason: 'expired or not-yet-valid' };
  }

  // 3. Signature recovers to the claimed wallet.
  let recovered: string;
  try {
    recovered = await deps.recover({
      message: canonicalAuthMessage(m),
      signature: req.signature,
    });
  } catch (e) {
    return { ok: false, reason: `signature recovery failed: ${(e as Error).message}` };
  }
  if (recovered.toLowerCase() !== req.ownerWallet.toLowerCase()) {
    return { ok: false, reason: 'signature does not match owner_wallet' };
  }

  // 4. Consume-once nonce (replay rejected) — only after a valid signature.
  if (!(await deps.nonces.consume(m.nonce))) {
    return { ok: false, reason: 'nonce already used (replay)' };
  }

  // 5. Community binding — bare signature is insufficient (SKP-001).
  if (!(await deps.isCommunityOwner({ wallet: req.ownerWallet, communityId: m.community_id }))) {
    return { ok: false, reason: 'wallet is not bound to the community' };
  }

  return { ok: true, wallet: req.ownerWallet.toLowerCase() };
}
