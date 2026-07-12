/**
 * Identity normalization — the SINGLE choke point for collection `entity_id`
 * (SDD §7). A labelled collection is identified by `(chain, contract)`, and
 * every belt / on-chain / worlds join must resolve to ONE canonical id or the
 * ledger would hold two entities for the same contract.
 *
 * Rules: chain → canonical decimal string (no leading zeros, positive, safe);
 * contract → lowercased `0x`+40hex. NO checksum-case identity, NO aliasing on
 * identity (`collection_key` is the only alias, and it is a LABEL, not the id).
 *
 * loa:shortcut: `packages/services/ordering/src/contract-address.ts` holds an
 * older copy of this pair. Not re-pointed here to avoid a cross-domain PR
 * (ordering is a separate commit-scope); consolidate when ordering is next
 * touched.
 */

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Lowercase EVM address, or null if not a well-formed 20-byte hex address. */
export function normalizeContractAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** Canonical decimal chain id (no leading zeros, positive, safe int), or null. */
export function normalizeChainId(chainId: string): string | null {
  const trimmed = chainId.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return String(n); // strips leading zeros: "080094" → "80094"
}

/**
 * The canonical collection identity `${chain}:${contract}`, or null if either
 * component is malformed. This is the ONLY function that mints an `entity_id`
 * and the ONLY key the ledger chains a collection's worldline on.
 */
export function collectionEntityId(chain: string, contract: string): string | null {
  const c = normalizeChainId(chain);
  const a = normalizeContractAddress(contract);
  if (c === null || a === null) return null;
  return `${c}:${a}`;
}
