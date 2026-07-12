/**
 * SonarClient — belt-gateway GraphQL transport over the Transfer-replay core.
 *
 * The belt-gateway is no-auth and SERVER-SIDE ONLY (never called from a
 * browser). The transport pages until the cursor is exhausted (sets
 * `paginationComplete`) or hits the upstream cap (IMP-009) and lets the pure
 * reconstruction decide validity. Each page fetch is circuit-broken (opossum),
 * mirroring the chain ScoreServiceClient pattern.
 */

import CircuitBreaker from 'opossum';
import { z } from 'zod';
import { diffQualification, reconstructOwnership } from './reconstruct.js';
import {
  type HolderDiff,
  type OwnershipAtBlock,
  type TokenStandard,
  type TransferEvent,
} from './types.js';

export const BELT_GATEWAY_ENDPOINT =
  'https://belt-gateway-production.up.railway.app/v1/graphql';

export interface SonarClientConfig {
  endpoint?: string;
  timeoutMs?: number;
  pageSize?: number;
  /** Upstream pagination cap per audit (IMP-009). */
  maxPages?: number;
  /** Reorg finality depth. */
  confirmations?: number;
}

const DEFAULTS: Required<SonarClientConfig> = {
  endpoint: BELT_GATEWAY_ENDPOINT,
  timeoutMs: 15_000,
  pageSize: 1_000,
  maxPages: 500,
  confirmations: 12,
};

export interface TransferPageArgs {
  endpoint: string;
  collection: string;
  /**
   * CRITICAL: the collection id is NOT unique across chains — "Honeycomb" is a collection on BOTH
   * Ethereum (1) and Berachain (80094), as are HoneyJar1-6. Querying by collection alone merges every
   * chain's Transfer rows into one replay, so the same tokenId is minted twice and reconstruction throws
   * ("mint of already-owned tokenId 1" — observed live against Honeycomb 2026-07-12). blockNumber is also
   * per-chain, so an `_lte` bound across merged chains is meaningless. ALWAYS scope by chainId.
   */
  chainId: number;
  lteBlock: number;
  limit: number;
  offset: number;
  timeoutMs: number;
}

/** One GraphQL Transfer-page query. Injectable so the core can be tested
 *  without network and the live wire-mapping is isolated. */
export type TransferPageFetcher = (args: TransferPageArgs) => Promise<TransferEvent[]>;

/**
 * Wire row → TransferEvent, VERIFIED against the live belt-gateway 2026-06-23
 * (GraphQL introspection + sample rows). The served Transfer type is
 * { id, blockNumber, chainId, collection, from, timestamp, to, tokenId,
 *   transactionHash }. Three corrections vs the prior [ASSUMPTION] mapping
 * (which 400'd against live — `field 'logIndex' not found in type 'Transfer'`):
 *   - the tx hash is exposed as `transactionHash`, not `txHash`;
 *   - there is NO `logIndex` column — it is recoverable from the row id, which
 *     is `<transactionHash>_<logIndex>` (e.g. `0xabc…_80`);
 *   - there is NO `value` column. ERC-721 needs none; ERC-1155 reconstruction
 *     refuses loudly on missing value (fold1155), which is correct until sonar
 *     exposes a per-transfer amount.
 * Hasura also serializes the `numeric` blockNumber as a STRING. Row validation
 * makes a schema drift a LOUD failure (the audit refuses) rather than a silent
 * mis-map.
 */
const TransferRowSchema = z
  .object({
    id: z.string().min(1),
    blockNumber: z.union([z.string(), z.number()]),
    transactionHash: z.string().min(1),
    from: z.string(),
    to: z.string(),
    tokenId: z.union([z.string(), z.number()]),
  })
  .transform((r, ctx): TransferEvent => {
    // Validate the RAW decimal string before Number() — Number() silently parses
    // hex (`0x…` addresses → a huge integer that passes Number.isInteger), empty
    // (`''`→0), scientific (`1e3`), binary/octal, and whitespace. The live Transfer
    // table already contains non-`_<decimal>` ids (e.g. crayons writes
    // `${txHash}_crayons_factory_${address}`), so a lax guard would mis-derive a
    // garbage logIndex instead of the advertised LOUD refusal.
    const blockStr = String(r.blockNumber);
    if (!/^\d+$/.test(blockStr)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: non-decimal blockNumber '${r.blockNumber}'` });
      return z.NEVER;
    }
    const blockNumber = Number(blockStr);
    if (!Number.isSafeInteger(blockNumber)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: blockNumber out of safe-integer range '${r.blockNumber}'` });
      return z.NEVER;
    }
    const logIndexStr = r.id.slice(r.id.lastIndexOf('_') + 1);
    if (!/^\d+$/.test(logIndexStr)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: Transfer id '${r.id}' does not end in _<decimal logIndex> — cannot derive logIndex` });
      return z.NEVER;
    }
    const logIndex = Number(logIndexStr);
    if (!Number.isSafeInteger(logIndex)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: derived logIndex out of safe-integer range from id '${r.id}'` });
      return z.NEVER;
    }
    return {
      blockNumber,
      logIndex,
      txHash: r.transactionHash,
      from: r.from,
      to: r.to,
      tokenId: String(r.tokenId),
      // value omitted — belt-gateway Transfer has no per-transfer amount (see header).
    };
  });

export const defaultTransferPageFetcher: TransferPageFetcher = async ({
  endpoint,
  collection,
  chainId,
  lteBlock,
  limit,
  offset,
  timeoutMs,
}) => {
  // $lte is `numeric!` (NOT Int!) — blockNumber is a Hasura numeric column and a
  // numeric `_lte` argument rejects an Int! variable. order_by uses `id` (stable,
  // exists) rather than the absent `logIndex`; reconstructOwnership re-sorts by
  // numeric (blockNumber, logIndex, tokenId) internally, so the wire order only
  // needs to be deterministic for offset pagination.
  // chainId is LOAD-BEARING in this where-clause, not decoration: collection ids repeat across chains
  // (Honeycomb + HoneyJar1-6 all exist on both Ethereum and Berachain). Without `chainId: {_eq: $chain}`
  // this merges every chain's rows into one ownership replay and reconstruction throws on the duplicate
  // mint. `Transfer.chainId: Int!` is served by sonar (schema.graphql) — it was simply never filtered on.
  const query = `query Transfers($c: String!, $chain: Int!, $lte: numeric!, $limit: Int!, $offset: Int!) {
  Transfer(
    where: { collection: { _eq: $c }, chainId: { _eq: $chain }, blockNumber: { _lte: $lte } }
    order_by: { blockNumber: asc, id: asc }
    limit: $limit
    offset: $offset
  ) {
    id
    blockNumber
    transactionHash
    from
    to
    tokenId
  }
}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: unknown;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query,
        variables: { c: collection, chain: chainId, lte: lteBlock, limit, offset },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`belt-gateway ${res.status}: ${await res.text()}`);
    }
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const envelope = z
    .object({
      data: z.object({ Transfer: z.array(z.unknown()) }).nullish(),
      errors: z.array(z.unknown()).optional(),
    })
    .parse(body);
  if (envelope.errors && envelope.errors.length > 0) {
    throw new Error(`belt-gateway GraphQL errors: ${JSON.stringify(envelope.errors)}`);
  }
  return z.array(TransferRowSchema).parse(envelope.data?.Transfer ?? []);
};

export class SonarClient {
  private readonly cfg: Required<SonarClientConfig>;
  private readonly fetchPage: TransferPageFetcher;
  private readonly breaker: CircuitBreaker<unknown[], unknown>;

  constructor(config: SonarClientConfig = {}, fetchPage?: TransferPageFetcher) {
    this.cfg = { ...DEFAULTS, ...config };
    this.fetchPage = fetchPage ?? defaultTransferPageFetcher;
    this.breaker = new CircuitBreaker(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      {
        timeout: this.cfg.timeoutMs,
        errorThresholdPercentage: 50,
        resetTimeout: 10_000,
        volumeThreshold: 3,
      },
    );
  }

  /** Reconstruct ownership @ snapshotBlock for a collection. */
  async ownershipAtBlock(args: {
    collection: string;
    /** REQUIRED: collection ids repeat across chains — see TransferPageArgs.chainId. */
    chainId: number;
    snapshotBlock: number;
    standard: TokenStandard;
    headBlock: number;
  }): Promise<OwnershipAtBlock> {
    const { events, complete } = await this.fetchAllTransfers(
      args.collection,
      args.chainId,
      args.snapshotBlock,
    );
    return reconstructOwnership(events, {
      standard: args.standard,
      snapshotBlock: args.snapshotBlock,
      headBlock: args.headBlock,
      confirmations: this.cfg.confirmations,
      paginationComplete: complete,
    });
  }

  /** Qualification diff between a snapshot block and a comparison (head) block. */
  async holderDiff(args: {
    collection: string;
    /** REQUIRED: collection ids repeat across chains — see TransferPageArgs.chainId. */
    chainId: number;
    snapshotBlock: number;
    compareBlock: number;
    standard: TokenStandard;
    threshold: bigint;
    headBlock: number;
  }): Promise<HolderDiff> {
    const snap = await this.ownershipAtBlock({
      collection: args.collection,
      chainId: args.chainId,
      snapshotBlock: args.snapshotBlock,
      standard: args.standard,
      headBlock: args.headBlock,
    });
    const head = await this.ownershipAtBlock({
      collection: args.collection,
      chainId: args.chainId,
      snapshotBlock: args.compareBlock,
      standard: args.standard,
      headBlock: args.headBlock,
    });
    return diffQualification(snap.balances, head.balances, args.threshold);
  }

  private async fetchAllTransfers(
    collection: string,
    chainId: number,
    lteBlock: number,
  ): Promise<{ events: TransferEvent[]; complete: boolean }> {
    const events: TransferEvent[] = [];
    let offset = 0;
    for (let page = 0; page < this.cfg.maxPages; page++) {
      const rows = (await this.breaker.fire(() =>
        this.fetchPage({
          endpoint: this.cfg.endpoint,
          collection,
          chainId,
          lteBlock,
          limit: this.cfg.pageSize,
          offset,
          timeoutMs: this.cfg.timeoutMs,
        }),
      )) as TransferEvent[];
      events.push(...rows);
      if (rows.length < this.cfg.pageSize) {
        return { events, complete: true }; // cursor exhausted
      }
      offset += this.cfg.pageSize;
    }
    return { events, complete: false }; // hit the upstream cap → not known-complete
  }
}
