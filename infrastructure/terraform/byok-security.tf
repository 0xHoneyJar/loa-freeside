# BYOK Network-Layer SSRF Defense — REMOVED 2026-08-19 (operator decision)
#
# This file previously declared the BYOK network-layer egress stack (Sprint 3,
# Task 3.7; SDD §3.4.5; AC-4.24..AC-4.28): a dedicated BYOK proxy subnet per
# AZ, an AWS Network Firewall with a domain-allowlist rule group, firewall
# policy, logging configuration, alert log groups, a dedicated route table +
# associations, the byok_proxy security group, VPC flow logs with their IAM
# role/policy, and a firewall-deny CloudWatch alarm — all gated by
# `variable "byok_enabled"` (default false).
#
# WHY IT WAS REMOVED:
#
#   * AWS Network Firewall bills per endpoint-hour (~$0.395/hr/endpoint)
#     whether or not it inspects a single packet. Deployed across two
#     environments and multiple AZs this is a four-figure monthly line item —
#     paid continuously by a feature that is not yet customer-facing.
#
#   * It had already been deployed and then deleted out-of-band for cost more
#     than once. That left this declaration as an ARMED REVERT: any apply with
#     the gate flipped on silently re-created the spend. Removing the recipe
#     makes re-introduction a deliberate, reviewed act instead of a side effect.
#
# WHAT REMAINS ACTIVE — THE SSRF DEFENSE IS NOT REMOVED:
#
#   Application-layer SSRF blocking in packages/adapters/agent/byok-proxy-handler.ts
#   (tests: tests/unit/byok-proxy-handler.test.ts) is untouched and remains the
#   operative control: URL scheme/host validation, private-range and metadata-
#   endpoint denial at request time. The firewall was the defense-in-DEPTH
#   layer, not the defense.
#
# SECURITY POSTURE CHANGE, STATED PLAINLY: BYOK egress is no longer
# network-layer constrained. If BYOK ships to real customers with real keys,
# an application-layer bypass is no longer backstopped by an egress allowlist.
#
# REOPEN CONDITION: reinstate a network-layer egress control WHEN the BYOK
# feature is customer-facing with real keys in scope — and bring the running
# cost to the operator explicitly at that point. A cheaper intermediate exists:
# an egress security group + proxy-enforced allowlist covers most of the threat
# at ~$0. The full recipe is recoverable from git history:
#   git log --follow -- infrastructure/terraform/byok-security.tf
#
# The `byok_enabled` variable is RETAINED below — ecs.tf feeds it to the
# application as the BYOK_ENABLED env flag, so it still gates the app-layer
# feature. It no longer creates any infrastructure.

variable "byok_enabled" {
  description = "Gates the app-layer BYOK feature flag (ecs.tf env BYOK_ENABLED) ONLY. As of 2026-08-19 this no longer creates network infrastructure - see the removal notice above."
  type        = bool
  default     = false
}
