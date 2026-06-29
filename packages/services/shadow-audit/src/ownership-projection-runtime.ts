/**
 * ownership-projection-runtime.ts — DRAFT: the live wiring of the keystone NATS flow (PR-ready the moment
 * sonar-api publishes ownership.changed). Holds the long-lived projection, subscribes it to the signed event
 * stream, and serves the audit's OwnershipSource with a SHADOW-THEN-CUTOVER fallback to raw sonar.
 *
 * The migration mirrors freeside's own shadow-mode doctrine — applied to the cutover itself:
 *   PHASE 1 (shadow)  — subscribe + maintain the projection from the worldline, but the audit still reads
 *                       SONAR for every collection (`isCutover` returns false). Run both; compare.
 *   PHASE 2 (cutover) — once the projection is verified to match sonar for a collection, flip it
 *                       (`isCutover(chain, contract) === true`) and the audit reads the SPINE for that one.
 *   Per-collection, reversible. A bad cutover falls back to sonar by flipping one bit.
 *
 * The worldline is the truth: the subscription is a DURABLE JetStream consumer, so the projection is always
 * rebuildable by replaying the stream from genesis (the read-model is derived, never the source of truth).
 * `subscribe` is INJECTED (the @freeside/events JetStream subscriber) so this runtime stays dep-light and the
 * fallback/cutover logic is unit-testable with fakes; the real glue wires it to `NFT_ACTIVITY_WILDCARD`.
 */
import { makeOwnershipProjection, makeProjectionOwnershipSource, type OwnershipProjection } from './projection-ownership-source.js';
import { applyOwnershipActivity, type OwnershipActivity } from './ownership-projection-subscriber.js';
import type { OwnershipSource } from './audit-service.js';

/** A live, durable subscription that feeds activities to a handler; stop() drains it. */
export interface ActivitySubscription {
  stop(): Promise<void>;
}

/** The injected @freeside/events JetStream subscriber: subscribe to a subject, get verified activities. */
export type SubscribeActivities = (
  subject: string,
  handler: (activity: OwnershipActivity) => void,
) => Promise<ActivitySubscription>;

export interface OwnershipProjectionRuntime {
  readonly projection: OwnershipProjection;
  /** the OwnershipSource the audit reads — the projection where cutover, raw sonar elsewhere. */
  readonly source: OwnershipSource;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The NATS subject the spine reads. Subscribe-only wildcard (every collection, every version). */
export const OWNERSHIP_ACTIVITY_SUBJECT = 'nft.activity.recorded.>';

export function makeOwnershipProjectionRuntime(opts: {
  subscribe: SubscribeActivities;
  /** the existing raw-sonar OwnershipSource (makeSonarOwnershipSource) — the fallback during shadow. */
  fallback: OwnershipSource;
  /** is the projection trusted for this collection yet? false = shadow (read sonar); true = cutover (read spine). */
  isCutover: (chain: string, contract: string) => boolean;
}): OwnershipProjectionRuntime {
  const projection = makeOwnershipProjection();
  const spine = makeProjectionOwnershipSource(projection);
  let sub: ActivitySubscription | null = null;

  const pick = (chain: string, contract: string): OwnershipSource =>
    opts.isCutover(chain, contract) ? spine : opts.fallback;

  const source: OwnershipSource = {
    resolveSnapshotBlock: (args) => pick(args.chain, args.contract).resolveSnapshotBlock(args),
    balancesAt: (args) => pick(args.chain, args.contract).balancesAt(args),
    currentBalances: (args) => pick(args.chain, args.contract).currentBalances(args),
  };

  return {
    projection,
    source,
    async start() {
      // DURABLE replay rebuilds the projection from the full worldline before/while serving.
      sub = await opts.subscribe(OWNERSHIP_ACTIVITY_SUBJECT, (a) => applyOwnershipActivity(projection, a));
    },
    async stop() {
      await sub?.stop();
      sub = null;
    },
  };
}
