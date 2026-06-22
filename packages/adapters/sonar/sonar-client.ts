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
 * Wire row → TransferEvent. The belt-gateway field names below match the
 * [OBSERVED] Transfer entity {blockNumber, collection, from, to, tokenId};
 * `logIndex`, `txHash` and `value` are [ASSUMPTION] pending live-schema
 * confirmation. Row validation makes a schema drift a LOUD failure (the audit
 * refuses) rather than a silent mis-map.
 */
const TransferRowSchema = z.object({
  blockNumber: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative(),
  txHash: z.string().min(1),
  from: z.string(),
  to: z.string(),
  tokenId: z.union([z.string(), z.number()]).transform(String),
  value: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? undefined : String(v))),
});

export const defaultTransferPageFetcher: TransferPageFetcher = async ({
  endpoint,
  collection,
  lteBlock,
  limit,
  offset,
  timeoutMs,
}) => {
  const query = `query Transfers($c: String!, $lte: Int!, $limit: Int!, $offset: Int!) {
  Transfer(
    where: { collection: { _eq: $c }, blockNumber: { _lte: $lte } }
    order_by: { blockNumber: asc, logIndex: asc }
    limit: $limit
    offset: $offset
  ) {
    blockNumber
    logIndex
    txHash
    from
    to
    tokenId
    value
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
