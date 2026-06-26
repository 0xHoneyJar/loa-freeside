/**
 * AllowAllPolicy — a TEST DOUBLE ONLY (SDD §8).
 *
 * Guarded so it can never be the deployed default: constructing it outside
 * `NODE_ENV=test` throws. This makes the "fail-closed by default" guarantee
 * structural rather than conventional (flatline SDD SKP-001/003).
 */

import type { IProducerPolicy, PolicyResult } from '../ports/producer-policy.js';

export class AllowAllPolicy implements IProducerPolicy {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'AllowAllPolicy is a test double and must not be used outside NODE_ENV=test. ' +
          'Use StaticProducerPolicy (fail-closed) in any deployed environment.',
      );
    }
  }

  verifyProducer(): PolicyResult {
    return { ok: true };
  }
}
