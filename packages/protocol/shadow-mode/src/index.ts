/**
 * @freeside/shadow-mode-protocol
 *
 * The shadow-mode ledger contract: the `shadow.event.v1` envelope, the 8
 * consumed-event payload schemas (sealed `.strict()`), the member-graph domain
 * types (subject/edge/observation/divergence/report), truth-status, alias
 * helpers, and the hounfour topic builders. Consumed by the shadow-mode service
 * (reducer + ports + HTTP) and any producer/consumer of shadow events.
 */

export {
  SourceKindSchema,
  type SourceKind,
  TruthStatusSchema,
  type TruthStatus,
  WalletRefSchema,
  type WalletRef,
  identityAlias,
  discordAlias,
  walletAlias,
  unresolvedAlias,
} from './schemas/common.js';

export {
  SCHEMA_VERSION,
  EventNameSchema,
  type EventName,
  envelopeBase,
  type EventEnvelope,
} from './schemas/envelope.js';

export {
  DiscordMemberSnapshotPayloadSchema,
  IdentityWalletLinkedPayloadSchema,
  IdentityAccountLinkedPayloadSchema,
  IdentityLinkRevokedPayloadSchema,
  SonarWalletAttributedPayloadSchema,
  IncumbentRoleObservedPayloadSchema,
  FreesideRoleComputedPayloadSchema,
  CommunityConfigUpdatedPayloadSchema,
  ShadowEventSchema,
  type ShadowEvent,
  type DiscordMemberSnapshotPayload,
  type IdentityWalletLinkedPayload,
  type IdentityAccountLinkedPayload,
  type IdentityLinkRevokedPayload,
  type SonarWalletAttributedPayload,
  type IncumbentRoleObservedPayload,
  type FreesideRoleComputedPayload,
  type CommunityConfigUpdatedPayload,
} from './schemas/events.js';

export {
  type SubjectKind,
  type AttributionQuality,
  type MergeProvenance,
  type ShadowSubject,
} from './schemas/subject.js';

export {
  type ShadowObservation,
  type ShadowEdge,
} from './schemas/edge.js';

export {
  type DivergenceKind,
  type ShadowDivergence,
  type MemberGraphProjection,
} from './schemas/divergence.js';

export { type ShadowReport } from './schemas/report.js';

export {
  buildTopic,
  type TopicSegments,
  SHADOW_EVENT_TOPICS,
} from './topics.js';

export { JcsError, jcsBytes, jcsCanonicalize } from './jcs.js';
