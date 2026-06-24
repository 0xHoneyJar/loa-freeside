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
    const blockNumber = Number(r.blockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: non-integer blockNumber '${r.blockNumber}'` });
      return z.NEVER;
    }
    const logIndex = Number(r.id.slice(r.id.lastIndexOf('_') + 1));
    if (!Number.isInteger(logIndex) || logIndex < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `belt-gateway: cannot derive logIndex from Transfer id '${r.id}'` });
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
  const query = `query Transfers($c: String!, $lte: numeric!, $limit: Int!, $offset: Int!) {
  Transfer(
    where: { collection: { _eq: $c }, blockNumber: { _lte: $lte } }
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
      body: JSON.stringify({ query, variables: { c: collection, lte: lteBlock, limit, offset } }),
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
      data: z.object({ Transfer: z.array(z.unknown()) }).optional(),
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
    snapshotBlock: number;
    standard: TokenStandard;
    headBlock: number;
  }): Promise<OwnershipAtBlock> {
    const { events, complete } = await this.fetchAllTransfers(args.collection, args.snapshotBlock);
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
    snapshotBlock: number;
    compareBlock: number;
    standard: TokenStandard;
    threshold: bigint;
    headBlock: number;
  }): Promise<HolderDiff> {
    const snap = await this.ownershipAtBlock({
      collection: args.collection,
      snapshotBlock: args.snapshotBlock,
      standard: args.standard,
      headBlock: args.headBlock,
    });
    const head = await this.ownershipAtBlock({
      collection: args.collection,
      snapshotBlock: args.compareBlock,
      standard: args.standard,
      headBlock: args.headBlock,
    });
    return diffQualification(snap.balances, head.balances, args.threshold);
  }

  private async fetchAllTransfers(
    collection: string,
    lteBlock: number,
  ): Promise<{ events: TransferEvent[]; complete: boolean }> {
    const events: TransferEvent[] = [];
    let offset = 0;
    for (let page = 0; page < this.cfg.maxPages; page++) {
      const rows = (await this.breaker.fire(() =>
        this.fetchPage({
          endpoint: this.cfg.endpoint,
          collection,
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
