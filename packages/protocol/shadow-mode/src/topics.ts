/**
 * Hounfour 3-segment topic builders for the shadow-mode event contract.
 *
 * Convention (matches `packages/events/src/topics.ts`):
 *   {aggregate}.{noun}.{verb}[.{specifier}].v{N}
 * All segments lowercase kebab-case; version suffix non-negotiable.
 *
 * NOTE (SDD §11 deviation, deliberate): the SDD proposed adding these to
 * `packages/events`; we keep them in the building's own protocol package so the
 * shadow-mode contract is self-contained and the blast radius stays inside the
 * building (surgical-changes principle). The validation mirrors the shared
 * builder exactly, so they can be hoisted to `packages/events` later if a
 * cross-building consumer needs them.
 */

const SEGMENT_RX = /^[a-z][a-z0-9-]*$/;

export interface TopicSegments {
  aggregate: string;
  noun: string;
  verb: string;
  specifier?: string;
  version: number;
}

function assertSegment(name: string, value: string): void {
  if (!SEGMENT_RX.test(value)) {
    throw new Error(
      `topic ${name} segment "${value}" must match /^[a-z][a-z0-9-]*$/ (lowercase kebab-case)`,
    );
  }
}

export function buildTopic(segments: TopicSegments): string {
  assertSegment('aggregate', segments.aggregate);
  assertSegment('noun', segments.noun);
  assertSegment('verb', segments.verb);
  if (segments.specifier !== undefined) assertSegment('specifier', segments.specifier);
  if (!Number.isInteger(segments.version) || segments.version < 1) {
    throw new Error(`topic version must be a positive integer (got ${segments.version})`);
  }
  const parts = [segments.aggregate, segments.noun, segments.verb];
  if (segments.specifier !== undefined) parts.push(segments.specifier);
  parts.push(`v${segments.version}`);
  return parts.join('.');
}

/** The 8 consumed-event subjects, built via {@link buildTopic} (all validate). */
export const SHADOW_EVENT_TOPICS = {
  discordMemberSnapshot: buildTopic({ aggregate: 'discord', noun: 'member', verb: 'snapshot', version: 1 }),
  identityWalletLinked: buildTopic({ aggregate: 'identity', noun: 'wallet', verb: 'linked', version: 1 }),
  identityAccountLinked: buildTopic({ aggregate: 'identity', noun: 'account', verb: 'linked', version: 1 }),
  identityLinkRevoked: buildTopic({ aggregate: 'identity', noun: 'link', verb: 'revoked', version: 1 }),
  sonarWalletAttributed: buildTopic({ aggregate: 'sonar', noun: 'wallet', verb: 'attributed', version: 1 }),
  incumbentRoleObserved: buildTopic({ aggregate: 'incumbent', noun: 'role', verb: 'observed', version: 1 }),
  freesideRoleComputed: buildTopic({ aggregate: 'freeside', noun: 'role', verb: 'computed', version: 1 }),
  communityConfigUpdated: buildTopic({ aggregate: 'community', noun: 'config', verb: 'updated', version: 1 }),
} as const;
