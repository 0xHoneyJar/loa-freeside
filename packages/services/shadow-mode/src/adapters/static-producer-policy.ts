/**
 * StaticProducerPolicy — the FAIL-CLOSED MVP default (SDD §8, NFR-2/3).
 *
 * Pure (no I/O). Enforces:
 *   - source → allowed event names (only `identity_api` may emit identity.*)
 *   - community scope (if the producer declares one, reject cross-community)
 *
 * loa:shortcut: source is self-asserted; this is a STRUCTURAL gate only. The
 * real trust boundary needs producer-auth (svc-JWT binding source↔caller).
 * Upgrade trigger: first live emitter / any deployed (non-test) POST /events.
 */

import type { EventName, SourceKind } from '@freeside/shadow-mode-protocol';
import type { IProducerPolicy, PolicyContext, PolicyResult } from '../ports/producer-policy.js';
import { AppendGrant } from '../auth/append-grant.js';

/** Which sources may emit which events. Fail-closed: anything not listed is rejected. */
const SOURCE_ALLOWED_EVENTS: Record<SourceKind, ReadonlySet<EventName>> = {
  identity_api: new Set([
    'identity.wallet.linked.v1',
    'identity.account.linked.v1',
    'identity.link.revoked.v1',
  ]),
  discord: new Set(['discord.member.snapshot.v1']),
  sonar: new Set(['sonar.wallet.attributed.v1']),
  incumbent_bot: new Set(['incumbent.role.observed.v1']),
  freeside: new Set(['freeside.role.computed.v1']),
  manual_config: new Set(['community.config.updated.v1']),
};

export class StaticProducerPolicy implements IProducerPolicy {
  verifyProducer(ctx: PolicyContext): PolicyResult {
    const allowed = SOURCE_ALLOWED_EVENTS[ctx.source];
    if (!allowed || !allowed.has(ctx.name)) {
      return { ok: false, reason: 'unauthorized_source' };
    }
    if (ctx.producer?.communities && !ctx.producer.communities.includes(ctx.communityId)) {
      return { ok: false, reason: 'cross_community' };
    }
    // Structural grant: scoped to exactly this (source, name) pair. Real
    // producer-auth grants come from JwtProducerPolicy (6b-3).
    return { ok: true, grant: AppendGrant._mint(`static:${ctx.source}`, [ctx.source], [ctx.name]) };
  }
}
