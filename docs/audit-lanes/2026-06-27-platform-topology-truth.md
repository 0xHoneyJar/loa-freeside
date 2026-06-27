# Audit lane: Platform topology, registry truth, and capability evidence

## Purpose

This draft PR distills Freeside's workspace topology, registry truth, CLI doctor, install-script, public-claim, and capability-evidence issues into one implementation lane. It is a routing artifact and does not claim the fixes are complete yet.

## Issue coverage

Refs #328, #330, #331, #332, #333, #334, #336, #337, #338, #339, #343, #344, #346, #347, #349, #351, #352, #353, #356, #357, #358, #359, #361, #362, #364.

## Preserved state

Preserve current Freeside platform behavior while making repo topology, registry source, CLI freshness, install side effects, and public capability claims verifiable.

## Target

Establish a checked source of truth for workspace layout, registry data, root scripts, README capability claims, and validation coverage.

## Expected artifacts

Likely scope includes root package/workspace files, registry artifacts, CLI doctor code, README/docs, topology manifests, validation scripts, and CI checks.

## Allowed scope

Allowed: focused topology, registry, docs, scripts, and CI changes. Not allowed: payment lifecycle changes, unrelated product direction, or adjacent repo edits.

## Decision

Use one topology/truth PR because these issues share one root contract: repo-visible product claims should be generated, checked, or explicitly sourced.

## Postinstall contract

Root `postinstall` must be side-effect-light by default. A normal dependency install must not rebuild Hounfour dist artifacts automatically.

Operators who need a local Hounfour dist refresh have two explicit paths:

1. Run `pnpm run build:hounfour`.
2. Set `FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1` before install to opt into the wrapper calling `scripts/rebuild-hounfour-dist.sh`.

The wrapper must propagate the rebuild script exit status when opt-in is enabled. This keeps install deterministic while preserving the existing rebuild command for operator-controlled use.

Validation hook: `node scripts/check-postinstall-wrapper.mjs` verifies that package scripts and wrapper behavior preserve this contract.

## Rollback

Rollback is the closing PR revert; implementation commits should keep generated checks and docs updates contained.

## Non-claims

This lane does not certify all Freeside runtime behavior and does not close issue references until implementation evidence is present. Current implementation covers the postinstall side-effect slice; registry truth, CLI freshness, workspace topology, and README capability evidence remain separate follow-up work unless additional commits are added.