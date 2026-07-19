import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AuditAggregateShapeSchema,
  AnonymousAuditOutputSchema,
  AuditRefusalEnvelopeSchema,
  SHADOW_AUDIT_PROTOCOL_VERSION,
} from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));

interface DashboardConsumerLock {
  schema_version: number;
  consumer_repository: string;
  consumer_commit: string;
  consumer_source: string;
  consumer_source_sha256: string;
  shadow_audit_protocol_version: string;
  anonymous_audit_output_fields: string[];
  aggregate_fields: string[];
  refusal_envelope_fields: string[];
}

function consumerLock(): DashboardConsumerLock {
  return JSON.parse(
    readFileSync(join(here, '../../fixtures/dashboard-consumer-lock.json'), 'utf8'),
  ) as DashboardConsumerLock;
}

describe('freeside-dashboard strict consumer lock', () => {
  it('pins the merged consumer commit and exact source artifact', () => {
    const lock = consumerLock();
    expect(lock.schema_version).toBe(1);
    expect(lock.consumer_repository).toBe('0xHoneyJar/freeside-dashboard');
    expect(lock.consumer_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.consumer_source).toBe('src/lib/freeside-worlds/access-audit/types.ts');
    expect(lock.consumer_source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails when the producer wire shape drifts beyond the pinned dashboard consumer', () => {
    const lock = consumerLock();
    expect(SHADOW_AUDIT_PROTOCOL_VERSION).toBe(lock.shadow_audit_protocol_version);
    // oxlint-disable-next-line unicorn/no-array-sort -- TypeScript target predates ES2023 toSorted
    expect(Object.keys(AnonymousAuditOutputSchema.shape).sort()).toEqual(
      lock.anonymous_audit_output_fields,
    );
    // oxlint-disable-next-line unicorn/no-array-sort -- TypeScript target predates ES2023 toSorted
    expect(Object.keys(AuditAggregateShapeSchema.shape).sort()).toEqual(lock.aggregate_fields);
    // oxlint-disable-next-line unicorn/no-array-sort -- TypeScript target predates ES2023 toSorted
    expect(Object.keys(AuditRefusalEnvelopeSchema.shape).sort()).toEqual(lock.refusal_envelope_fields);
  });
});
