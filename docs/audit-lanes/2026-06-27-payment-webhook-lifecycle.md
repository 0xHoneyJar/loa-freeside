# Audit lane: Payment webhook lifecycle hardening

## Purpose

This draft PR distills Freeside's payment webhook and credit-lifecycle issues into one implementation lane. It is a routing artifact and does not claim the fixes are complete yet.

## Issue coverage

Refs #325, #326, #327, #329, #335, #340, #341, #342, #345, #348, #350, #354, #355, #360, #363.

## Preserved state

Preserve current Freeside platform behavior outside the payment webhook and credit-lifecycle surfaces named by these issues.

## Target

Define and prove a durable payment webhook state machine covering raw body verification, timestamp policy, duplicate handling, status progression, dependency failures, feature flags, retries, and credit minting evidence.

## Expected artifacts

Likely scope includes `packages/routes/webhooks.routes.ts`, payment/billing service tests, webhook fixtures, feature-flag checks, and operator runbook updates.

## Allowed scope

Allowed: focused payment code, tests, fixtures, and docs. Not allowed: unrelated registry, topology, CLI, or product-direction changes.

## Decision

Use one payment lifecycle PR because these issues share one root contract: payment receipt, processing, retry, and credit mutation must be explicit and auditable.

## Rollback

Rollback is the closing PR revert; implementation commits should keep payment behavior changes contained.

## Non-claims

This lane does not claim all Freeside production readiness and does not close issue references until implementation evidence is present.