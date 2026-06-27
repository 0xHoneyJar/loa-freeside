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

## Rollback

Rollback is the closing PR revert; implementation commits should keep generated checks and docs updates contained.

## Non-claims

This lane does not certify all Freeside runtime behavior and does not close issue references until implementation evidence is present.