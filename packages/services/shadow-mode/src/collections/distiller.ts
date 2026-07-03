/**
 * The collection distiller — `ground()` (SDD collections-sot §3, §9).
 *
 * Bottom-up distillation of raw signals into derived labels: belt-gateway
 * (collection_key + chain + contract) + on-chain ERC-165 (token_standard) +
 * a world-binding proposal. Every external edge is INJECTED (the FR-7
 * reuse-shaping seam + hermetic tests): a second labelled-entity kind supplies
 * its own `ground()` and inherits propose/ratify/drift.
 *
 * ERC-165 is dependency-free: a raw `eth_call` to `supportsInterface(bytes4)`
 * (selector 0x01ffc9a7). erc721 = 0x80ac58cd, erc1155 = 0xd9b67a26; neither
 * (false / revert / transient failure) → `unknown` (RATIFY-ONLY, never assume
 * erc721 — the grounded hazard).
 */

import type { TokenStandard } from '@freeside/shadow-mode-protocol';

export const ERC165_SUPPORTS_INTERFACE_SELECTOR = '0x01ffc9a7';
export const ERC721_INTERFACE_ID = '80ac58cd';
export const ERC1155_INTERFACE_ID = 'd9b67a26';

/** A collection as the belt knows it (its own vocabulary — collectionKey is an ALIAS). */
export interface BeltCollection {
  collectionKey: string;
  chainId: string;
  contract: string;
}

/** The distilled derived labels for one collection (subjective labels ratified later). */
export interface DerivedCollection {
  chain: string;
  contract: string;
  collection_key: string;
  token_standard: TokenStandard;
  /** Proposed world binding (heuristic/lookup) — unratified until the operator signs it. */
  world_proposed?: string;
}

/** An injected JSON-RPC eth_call. Returns the hex result, or null on revert/failure. */
export type EthCall = (chainId: string, to: string, data: string) => Promise<string | null>;

/** Injected belt read. */
export type BeltRead = () => Promise<BeltCollection[]>;

export interface GroundDeps {
  belt: BeltRead;
  ethCall: EthCall;
  /** Optional reverse worlds lookup; falls back to the key-prefix heuristic. */
  lookupWorld?: (chain: string, contract: string) => Promise<string | undefined>;
}

/**
 * Normalize a belt collection_key to the event-schema grammar
 * (`packages/events/src/schemas/nft-activity.ts`, `/^[a-z][a-z0-9-]*$/`): the
 * belt emits underscores (`apdao_seat`), the consuming schema wants hyphens.
 * Returns null if the result still doesn't match the grammar (surfaced, never
 * silently mangled).
 */
export function normalizeCollectionKey(key: string): string | null {
  const hyphenated = key.trim().toLowerCase().replace(/_/g, '-');
  return /^[a-z][a-z0-9-]*$/.test(hyphenated) ? hyphenated : null;
}

/** Build the padded supportsInterface(bytes4) calldata for an interface id. */
function supportsInterfaceCalldata(interfaceId: string): string {
  // selector (4 bytes) + interfaceId (4 bytes) left-aligned, right-padded to 32 bytes
  return ERC165_SUPPORTS_INTERFACE_SELECTOR + interfaceId + '0'.repeat(56);
}

/**
 * Detect the token standard via ERC-165 (SDD §3 hazard 2): erc721 first, then
 * erc1155, else `unknown`. A contract that omits ERC-165 (legacy) reverts →
 * `unknown`, NEVER assumed erc721.
 */
export async function detectTokenStandard(
  chainId: string,
  contract: string,
  ethCall: EthCall,
): Promise<TokenStandard> {
  const supports = async (interfaceId: string): Promise<boolean> => {
    try {
      const res = await ethCall(chainId, contract, supportsInterfaceCalldata(interfaceId));
      return decodeBool(res);
    } catch {
      return false; // transient/revert → treated as unsupported (degrades to unknown)
    }
  };
  if (await supports(ERC721_INTERFACE_ID)) return 'erc721';
  if (await supports(ERC1155_INTERFACE_ID)) return 'erc1155';
  return 'unknown';
}

/** Decode an ABI bool return (32-byte word; true = ...0001). */
export function decodeBool(result: string | null): boolean {
  if (!result) return false;
  const hex = (result.startsWith('0x') ? result.slice(2) : result).replace(/^0+/, '');
  return hex === '1';
}

/**
 * Key-prefix world heuristic (proposal only, unratified). EXPLICIT allowlist of
 * the real mibera-family stems (FAGAN H-1): a bare `mi` catch-all misclassifies
 * unrelated `mi*` keys (mint-pass, mirage, …) as mibera. Keys are already
 * `_`→`-` normalized before this runs, so only hyphenated stems appear.
 */
export function proposeWorldFromKey(collectionKey: string): string | undefined {
  const k = collectionKey.toLowerCase();
  if (k.startsWith('puru-')) return 'purupuru';
  if (k.startsWith('apdao')) return 'apdao';
  if (/^(mibera|miladies|miparcels|mireveal|lore-)/.test(k)) return 'mibera';
  return undefined;
}

/**
 * Ground every belt-tracked collection into derived labels (READ-only). The
 * `LabelledEntity.ground()` for collections; the concrete belt+ERC-165+worlds
 * impl a second entity kind would swap out (FR-7).
 */
export async function ground(deps: GroundDeps): Promise<DerivedCollection[]> {
  const belt = await deps.belt();
  const out: DerivedCollection[] = [];
  for (const c of belt) {
    const collection_key = normalizeCollectionKey(c.collectionKey);
    if (collection_key === null) continue; // ungrammatical key surfaced by the caller's diff, skipped here
    const token_standard = await detectTokenStandard(c.chainId, c.contract, deps.ethCall);
    const world_proposed =
      (deps.lookupWorld ? await deps.lookupWorld(c.chainId, c.contract) : undefined) ??
      proposeWorldFromKey(collection_key);
    out.push({ chain: c.chainId, contract: c.contract, collection_key, token_standard, world_proposed });
  }
  return out;
}
