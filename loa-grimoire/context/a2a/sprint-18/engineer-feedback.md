# Sprint 18 Review Feedback

## Overall Assessment

Sprint 18 implementation is **MOSTLY COMPLETE** with some critical issues that must be addressed before approval. The core notification features (tier promotion DMs, badge award DMs) are well-implemented, but there are gaps in acceptance criteria fulfillment and missing test coverage.

## Critical Issues (Must Fix Before Approval)

### 1. **S18-T1: Acceptance Criteria Gap - "Notification respects user preferences"**
**File**: `sietch-service/src/services/notification.ts:179`
**Issue**: Tier promotion notifications are marked as "critical" alerts that bypass rate limiting, but they do not respect user preference toggles (positionUpdates, atRiskWarnings, naibAlerts).

**Why This Matters**: The acceptance criteria explicitly states "Notification respects user preferences". While bypassing rate limits for critical events is reasonable, there should still be a way for users to opt out of tier promotion notifications entirely.

**Required Fix**:
1. Add a new preference field like `tierPromotionAlerts: boolean` to NotificationPreferences type
2. Check this preference in `canSendAlert()` before allowing tier_promotion alerts
3. Or document explicitly in the sprint plan why tier promotions should ALWAYS be sent (as critical milestones)

**Reference**: See acceptance criteria in `loa-grimoire/sprint.md` S18-T1

---

### 2. **S18-T2: Acceptance Criteria Gap - "Water Sharer badge DM mentions The Oasis"**
**File**: `sietch-service/src/discord/embeds/alerts.ts:586-625`
**Issue**: The badge award embed for Water Sharer badge mentions sharing ability but does NOT mention "The Oasis" channel access as specified in acceptance criteria.

**Why This Matters**: The PRD and SDD indicate Water Sharer badge grants access to The Oasis channel. Users need to know about this privilege.

**Required Fix**: Update the Water Sharer badge award message in `buildBadgeAwardAlertEmbed()`:

```typescript
if (data.isWaterSharer) {
  embed.addFields({
    name: '🏝️ The Oasis Access',
    value: 'You now have access to **#the-oasis** - an exclusive channel for Water Sharers.',
    inline: false,
  });
}
```

**Reference**: See acceptance criteria in `loa-grimoire/sprint.md` S18-T2

---

### 3. **S18-T3: Acceptance Criteria Gap - "Notifications only for actual promotions (not first assignment)"**
**File**: `sietch-service/src/trigger/syncEligibility.ts:174-203`
**Issue**: The sync task sends tier promotion DMs for all tier changes where `oldTier !== newTier`. However, this will send a DM on FIRST tier assignment (when oldTier is null), which violates the acceptance criteria.

**Why This Matters**: New members joining the server should not receive a "Congratulations on your promotion!" DM when they're just being assigned their initial tier. This creates a confusing onboarding experience.

**Required Fix**: Check if `oldTier` is null before sending the promotion DM:

```typescript
// Line ~193 in syncEligibility.ts
if (isPromotion && oldTier !== null) {  // Only send if not first assignment
  try {
    await notificationService.sendTierPromotion(profile.memberId, {
      oldTier: oldTier,  // Safe now that we checked for null
      newTier,
      newTierName: TIER_DISPLAY_NAMES[newTier] || newTier,
      bgtThreshold: TIER_THRESHOLDS[newTier] ?? null,
      isRankBased: ['fedaykin', 'naib'].includes(newTier),
    });
    tierStats.dmsSent++;
  } catch (dmError) {
    // ... error handling
  }
}
```

**Reference**: See acceptance criteria in `loa-grimoire/sprint.md` S18-T3

---

### 4. **S18-T4: Missing Implementation - API Endpoints**
**Files**: NOT CREATED
**Issue**: The acceptance criteria for S18-T4 explicitly requires:
- `DELETE /admin/water-share/:memberId` API endpoint
- `GET /admin/water-share/lineage` API endpoint

**Why This Matters**: The sprint plan calls for BOTH Discord commands AND API endpoints. The API endpoints are needed for web-based admin tools or future dashboard integrations.

**Required Fix**: Create `sietch-service/src/api/handlers/admin-water-share.ts` with:

```typescript
import { Router } from 'express';
import { revokeGrant, getBadgeLineage } from '../../services/WaterSharerService.js';
import { getMemberProfileById } from '../../db/queries.js';

const router = Router();

// DELETE /admin/water-share/:memberId
// Revoke Water Sharer badge and all grants for a member
router.delete('/:memberId', async (req, res) => {
  const { memberId } = req.params;
  const adminId = req.user?.discordUserId; // Assumes auth middleware

  // Find active grant for this member
  const grants = listAllActiveGrants();
  const grant = grants.find(g =>
    g.recipient.memberId === memberId || g.granter.memberId === memberId
  );

  if (!grant) {
    return res.status(404).json({ error: 'No active grant found' });
  }

  const revokeCount = revokeGrant(grant.grant.id, adminId);
  res.json({ success: true, revokeCount });
});

// GET /admin/water-share/lineage
// Get full badge lineage tree
router.get('/lineage', async (req, res) => {
  const grants = listAllActiveGrants();
  const lineageTree = grants.map(g => ({
    grantId: g.grant.id,
    granter: { memberId: g.granter.memberId, nym: g.granter.nym },
    recipient: { memberId: g.recipient.memberId, nym: g.recipient.nym },
    grantedAt: g.grant.grantedAt,
  }));

  res.json({ lineage: lineageTree });
});

export default router;
```

Then register in `sietch-service/src/api/routes.ts`:
```typescript
import adminWaterShareRoutes from './handlers/admin-water-share.js';
app.use('/admin/water-share', requireAdmin, adminWaterShareRoutes);
```

**Reference**: See acceptance criteria in `loa-grimoire/sprint.md` S18-T4

---

### 5. **S18-T5: Missing Test Coverage for Usul Ascended Auto-Award**
**Files**: No test file found
**Issue**: There are no automated tests verifying that the Usul Ascended badge is actually auto-awarded when a member reaches the Usul tier.

**Why This Matters**: Auto-award logic is critical functionality that can silently fail. Without tests, we cannot verify the badge is awarded correctly or that the DM is sent.

**Required Fix**: Add tests to `tests/integration/badges.test.ts`:

```typescript
describe('Usul Ascended Badge', () => {
  it('should auto-award Usul Ascended badge when member reaches Usul tier', async () => {
    // Setup: Member at Sayyadina tier (888 BGT)
    // Action: Promote to Usul tier (1111 BGT)
    // Assert: usul-ascended badge is awarded
    // Assert: Badge award DM was sent
  });

  it('should not award Usul Ascended badge again if member already has it', async () => {
    // Verify idempotency
  });

  it('should persist Usul Ascended badge if member is later promoted to Fedaykin', async () => {
    // Verify badge persists through tier changes
  });
});
```

**Reference**: See "Testing Recommendations" in implementation report

---

## Non-Critical Improvements (Recommended)

### 1. **Inconsistent Naming: `oldTier` vs `from_tier`**
**Files**:
- `sietch-service/src/types/index.ts:998` - Uses `oldTier`
- `sietch-service/src/services/TierService.ts:385` - Database uses `from_tier`

**Suggestion**: Document this naming convention difference or consider aligning them for consistency. The type system uses camelCase (oldTier) while the database uses snake_case (from_tier), which is fine, but should be documented in the SDD.

**Benefit**: Reduces cognitive load when switching between database queries and TypeScript code.

---

### 2. **Missing Error Handling for Badge Service in Sync**
**File**: `sietch-service/src/trigger/syncEligibility.ts:196-203`
**Observation**: The code catches DM errors but doesn't catch badge service errors (the badge award attempt itself could throw).

**Suggestion**: Wrap the badge award call in its own try-catch:

```typescript
// Award Usul Ascended badge
if (newTier === 'usul' && !memberHasBadge(profile.memberId, BADGE_IDS.usulAscended)) {
  try {
    const badgeAwarded = awardBadge(profile.memberId, BADGE_IDS.usulAscended, {
      awardedBy: null,
      reason: 'Auto-awarded for reaching Usul tier',
    });

    // Only send DM if badge was successfully awarded
    if (badgeAwarded) {
      try {
        await notificationService.sendBadgeAward(profile.memberId, { ... });
      } catch (dmError) {
        triggerLogger.warn('Failed to send Usul Ascended badge DM', { ... });
      }
    }
  } catch (badgeError) {
    triggerLogger.error('Failed to award Usul Ascended badge', {
      memberId: profile.memberId,
      error: badgeError instanceof Error ? badgeError.message : String(badgeError),
    });
  }
}
```

**Benefit**: Prevents badge award failures from breaking the entire sync task. Improves resilience.

---

### 3. **Water Sharer Management: Misleading Command Name**
**File**: `sietch-service/src/discord/commands/admin-water-share.ts:8`
**Observation**: The comment says "revoke [grant_id]" but the acceptance criteria says "revoke @user". The implementation uses grant_id, not a user mention.

**Suggestion**: Update the acceptance criteria in sprint.md or change the command to accept a nym/user instead of grant_id for better UX:

```typescript
// Instead of:
/admin-water-share revoke [grant_id: abc123...]

// Consider:
/admin-water-share revoke [nym: "JohnDoe"]
// Then look up the grant internally
```

**Benefit**: More intuitive for admins - they think in terms of members, not grant UUIDs.

---

## Positive Observations

**What Was Done Well**:

1. **Excellent Error Handling**: The tier sync gracefully handles DM failures without breaking the sync process (lines 196-203 in syncEligibility.ts). This is exactly the right approach for non-critical notifications.

2. **Comprehensive Embed Design**: The `buildTierPromotionEmbed()` and `buildBadgeAwardAlertEmbed()` functions have thoughtful messaging with different variants for rank-based vs BGT-based tiers. The Water Sharer badge embed explains the sharing mechanic clearly.

3. **Proper Critical Alert Classification**: Both tier_promotion and badge_award are correctly classified as critical alerts that bypass rate limiting (line 179 in notification.ts). These are important milestones that should always be delivered.

4. **Good Logging**: The sync task logs DM sent counts and errors, making it easy to monitor notification delivery in production (tierStats tracking).

5. **Clean Migration**: The Usul Ascended badge migration (008_usul_ascended.ts) is well-structured with proper rollback SQL and uses INSERT OR IGNORE to prevent conflicts.

6. **Admin Tool Polish**: The `/admin-water-share` command has autocomplete for grant_id and nym, which greatly improves UX. The lineage view is a nice touch for auditing.

---

## Acceptance Criteria Status

### S18-T1: Tier Promotion DM
- ✅ `sendTierPromotion()` method implemented
- ✅ DM includes tier name and threshold
- ✅ DM mentions new channels available
- ✅ DM follows existing notification format
- ❌ **Notification respects user preferences** (Critical Issue #1)
- ✅ Failure to send DM doesn't break sync

**Status**: 5/6 criteria met - **NEEDS FIX**

---

### S18-T2: Badge Award DM
- ✅ `sendBadgeAward()` method implemented
- ✅ DM includes badge name and description
- ❌ **Water Sharer badge DM mentions The Oasis** (Critical Issue #2)
- ✅ DM follows existing notification format
- ✅ Badge award logs notification sent

**Status**: 4/5 criteria met - **NEEDS FIX**

---

### S18-T3: Promotion Notifications in Sync
- ✅ Promotion notifications sent after role update
- ✅ Notifications batched (sent after all tier calculations)
- ✅ Failed notifications logged but don't stop sync
- ✅ Promotion count includes notified members (dmsSent counter)
- ❌ **Notifications only for actual promotions (not first assignment)** (Critical Issue #3)

**Status**: 4/5 criteria met - **NEEDS FIX**

---

### S18-T4: Admin Water Sharer Management
- ✅ `/admin-water-share revoke [grant_id]` revokes badge (cascades)
- ✅ `/admin-water-share list` shows badge lineage (via listAllActiveGrants)
- ❌ **`DELETE /admin/water-share/:memberId` API endpoint** (Critical Issue #4)
- ❌ **`GET /admin/water-share/lineage` API endpoint** (Critical Issue #4)
- ✅ Revocation cascade removes badge from all downstream recipients
- ✅ Revocation logs admin who revoked
- ✅ Member can receive badge again after revocation (verified in code)

**Status**: 5/7 criteria met - **NEEDS FIX**

---

### S18-T5: Usul Ascended Badge
- ✅ `usul-ascended` badge ID defined (BADGE_IDS.usulAscended)
- ✅ Badge name: "Usul Ascended"
- ✅ Badge description: "Reached the Usul tier (1111+ BGT)"
- ✅ Badge auto-awarded on Usul promotion (syncEligibility.ts:196)
- ✅ Badge persists if member later reaches Fedaykin (tier change doesn't remove badges)
- ✅ Badge award triggers notification (lines 198-203)

**Status**: 6/6 criteria met - **PASS** (but needs tests - see Critical Issue #5)

---

## Sprint 18 Success Criteria
- ❌ Promotions trigger DM notifications (needs fix for first assignment check)
- ✅ Badge awards trigger DM notifications
- ✅ Usul Ascended badge auto-awarded
- ⚠️ Admin can revoke invites (Discord command yes, API endpoints missing)

**Overall Sprint Status**: 3/4 success criteria met - **NEEDS WORK**

---

## Summary of Required Actions

Before this sprint can be approved, the following MUST be addressed:

1. **Fix Critical Issue #1**: Add user preference check for tier promotion alerts OR document why they're always sent
2. **Fix Critical Issue #2**: Add "The Oasis" mention to Water Sharer badge award embed
3. **Fix Critical Issue #3**: Check for `oldTier !== null` before sending promotion DMs
4. **Fix Critical Issue #4**: Implement missing API endpoints for admin Water Sharer management
5. **Fix Critical Issue #5**: Add automated tests for Usul Ascended badge auto-award

**Estimated Fix Time**: 2-3 hours

---

## Next Steps

1. Address all 5 critical issues listed above
2. Add the recommended test coverage for Usul Ascended badge
3. Run manual testing checklist from implementation report
4. Update implementation report with "Feedback Addressed" section listing all fixes
5. Request re-review

**Approval Status**: ❌ **CHANGES REQUIRED**

The implementation is close to completion and shows good attention to detail in most areas. However, the gaps in acceptance criteria must be addressed to ensure the feature works as designed in the PRD/SDD. Once the critical issues are fixed, this sprint should be ready for production.
