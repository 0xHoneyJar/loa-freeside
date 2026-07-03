/**
 * AllowAllPolicy — a TEST DOUBLE ONLY (SDD §8).
 *
 * Guarded so it can never be the deployed default: constructing it outside
 * `NODE_ENV=test` throws. This makes the "fail-closed by default" guarantee
 * structural rather than conventional (flatline SDD SKP-001/003).
 */

import type { IProducerPolicy, PolicyContext, PolicyResult } from '../ports/producer-policy.js';
import { AppendGrant } from '../auth/append-grant.js';

export class AllowAllPolicy implements IProducerPolicy {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'AllowAllPolicy is a test double and must not be used outside NODE_ENV=test. ' +
          'Use StaticProducerPolicy (fail-closed) in any deployed environment.',
      );
    }
  }

  verifyProducer(ctx: PolicyContext): PolicyResult {
    return { ok: true, grant: AppendGrant._mint('allow-all-test', [ctx.source], [ctx.name]) };
  }
}
