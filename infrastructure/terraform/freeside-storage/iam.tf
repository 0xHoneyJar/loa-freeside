# =============================================================================
# freeside-storage — IAM Roles (DEFERRED per Amendment 3)
# =============================================================================
#
# Per SDD §0.1 Amendment 3 (2026-04-29), the cross-account assumed-role pattern
# (readonly + writer roles for bulk sync between legacy + new buckets) is no
# longer needed. Reality: single account, single backing bucket — no cross-
# account role assumption required. OAC on the new distribution handles bucket
# access without role-assumption.
#
# This file is a placeholder kept to match the SDD §7.1 module skeleton spec.
#
# Future cycles MAY add IAM roles when:
#   - Cross-account deploys are introduced (e.g., pre-prod / prod isolation)
#   - The operator-facing parity script wants a least-privilege role distinct
#     from the admin profile
#   - Trigger.dev jobs need scoped write access (cf. T25 STRETCH)
#
# References:
#   - SDD §0.1 Amendment 3
#   - decisions/006-image-optimizer-stays-on-d163.md
# =============================================================================

# (intentionally empty)
