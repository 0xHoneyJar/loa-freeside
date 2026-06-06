# PRD: Cluster-Coherence Foundation — P0 Seam Cadence Counter + Absent-Series Alert

> **Status**: DRAFT
> **Cycle**: cycle/coherence-foundation
> **Date**: 2026-06-03
> **Scope**: P0 only — additive, reversible, single-repo `loa-freeside`. P1 deferred.
> **Mode**: SHIP (report-only, no fail-block teeth this sprint)

---

## Problem Statement

The cluster's Prometheus alerting has a structural correctness defect: every alert in
`infrastructure/observability/prometheus/alerts.yml` uses threshold comparisons (`== 0`,
`rate(...) > N`, `count(...)`). Prometheus discovers targets via `kubernetes_sd_configs
role:pod`. When a pod is deleted or crash-loops, its metric series **vanishes from
discovery** — it does not emit `0`, it simply ceases to exist. A `== 0` rule cannot fire
on a series that is absent; only `absent_over_time()` survives target disappearance.

Confirmed: zero `absent_over_time()` or `absent()` rules exist anywhere in
`infrastructure/observability/prometheus/` (grep clean as of 2026-06-03).

Consequence: a dead producer is indistinguishable from a healthy-but-quiet producer.
`agreement = silence` and `producer = dead` look identical in every alert we own.
This is **INV-3 (free-energy / absence) — a correctness defect**, classified in
`grimoires/loa/context/2026-06-03-building-membrane-baseline.md`. It is the precondition
defect: until silence ≠ death, no "agreement = green" coherence signal is trustworthy —
including P1's own membrane-check success conditions.

The only seam worth fixing first is `nft.mint.detected.v1` — the one genuine
cadence-bearing bus seam declared in `packages/events/src/topics.ts:75` (sonar → consumers
via NATS/ACVP). If sonar stops indexing, that silence MUST become loud within a bounded
window.

---

## Goals & Success Metrics

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Close INV-3: silence ≠ death for the `nft.mint.detected.v1` seam | `absent_over_time()` alert exists and fires within the configured window when the publisher is paused |
| G-2 | Prove the correctness distinction vs the existing `== 0` rules | When publisher is paused: new `absent_over_time` rule fires AND existing threshold rules do NOT fire (series is absent, not zero) |
| G-3 | Emit a per-seam publish counter at the NATS publisher motor edge | `gateway_events_published_total{subject}` counter exists in the gateway Prometheus registry, incremented on each successful JetStream ACK |
| G-4 | Findings surface in freeside-coherence explorer | The absence alert's firing state is readable from the coherence surface; this sprint does not end as another deployed-but-unconsumed artifact |

---

## Scope

### P0 — In Scope (this cycle)

1. **Counter addition** — add `gateway_events_published_total{subject}` to the Rust gateway
   metrics module. Incremented at the JetStream ACK success path in the publisher.
2. **Alert addition** — add an `absent_over_time()` / expected-cadence rule to
   `infrastructure/observability/prometheus/alerts.yml` for `nft.mint.detected.v1`.
3. **Kill/prove** — a documented test procedure demonstrating the rule fires when the
   publisher is paused and the existing `== 0` rules do NOT.
4. **Coherence surface wire** — the alert firing state is readable from freeside-coherence
   explorer (prevents deployed-but-unconsumed).

### P1 — Explicitly Deferred (next cycle)

- BeaconV3 `membrane` field schema addition (`packages/beacon-schema/src/beacon-v3.ts`)
- `ts-morph` AST membrane extractor tool
- `freeside-cli graph dump` composed from `list.ts` + `checkComposesWith`
- `doctor.ts` `checkMembrane` sub-check (declared-vs-real edge comparison)
- Cross-field race fixture for the `sealed_schemas[0].hash ↔ cluster.eventsPin` invariant
- Fanning out membrane declarations to remaining 7 cells (auth's 6 undeclared routes, mediums' denied config-edge, score ghost)

---

## Detailed Requirements

### R-1: Per-Seam Published-Cadence Counter

**File**: `apps/gateway/src/metrics/mod.rs` (module at `apps/gateway/src/metrics/mod.rs`)

The existing `GatewayMetrics` struct (`metrics/mod.rs:13`) already registers four counters
via the `metrics` crate (`describe_counter!` calls at lines 35–54). A fifth counter must be
added:

```
gateway_events_published_total{subject}
```

- **Type**: Counter
- **Label**: `subject` — the NATS subject string (e.g. `nft.mint.detected.v1`,
  `commands.interaction`)
- **Description**: "Total events published to JetStream by NATS subject"
- **Increment site**: `apps/gateway/src/nats/publisher.rs:publish_event` at the
  JetStream ACK success path (currently line 127–128: `self.messages_published.fetch_add(1,
  Ordering::Relaxed)`). The new Prometheus counter increment must fire at the same logical
  moment — after `ack_future.await` returns `Ok(ack)`.
- **Subject value**: the `subject` variable already in scope at that call site (computed by
  `route_event`, line 108).

The existing `self.messages_published` AtomicU64 (publisher.rs:41) is an internal
accounting counter and is NOT replaced — it remains for its current purpose. The new counter
is additive.

The `record_route_success` method (`metrics/mod.rs:106`) currently increments
`gateway_events_routed_total{shard_id}`. It does NOT carry a subject label and MUST NOT be
repurposed for this requirement — the new counter is a distinct instrument at the motor edge.

### R-2: Absent-Series Alert Rule

**File**: `infrastructure/observability/prometheus/alerts.yml`

Add a new alert group `arrakis-seam-cadence` with at minimum one rule:

```yaml
- alert: SeamNftMintDetectedSilent
  expr: absent_over_time(gateway_events_published_total{subject="nft.mint.detected.v1"}[30m])
  for: 0m
  labels:
    severity: warning
    component: seam
    seam: nft.mint.detected.v1
  annotations:
    summary: "nft.mint.detected.v1 seam has produced no events for 30 minutes"
    description: "The nft.mint.detected.v1 cadence seam has been silent for 30m. Either the sonar publisher stopped indexing or the gateway series is absent (pod deleted/crashed). absent_over_time fires; == 0 rules cannot."
    runbook_url: "https://wiki.internal/runbooks/seam-silence"
```

- The 30-minute window is the initial setting; it should be configurable via a label or
  comment with a rationale note. Sonar's indexing cadence drives the correct value — if
  mint events are expected at least once per hour in normal operation, 30m is conservative
  and appropriate.
- `for: 0m` — fires immediately on first absent evaluation (no false-negative window during
  a fast kill/prove test); the SDD may adjust.
- The `seam` label is a new label dimension for coherence surface filtering.

### R-3: Kill/Prove Protocol

The acceptance proof is NOT optional. It must be documented in a runbook or inline in this
PRD's acceptance criteria and executed before the sprint is marked complete.

**Prove** (must both be true simultaneously):
1. After pausing the publisher (stopping the gateway pod or blocking its JetStream
   connection), `SeamNftMintDetectedSilent` fires within the configured window.
2. The existing rules (`GatewayShardDown`, `GatewayNATSPublishFailures`, all `== 0`-class
   rules) do NOT fire during the same window for the same root cause — because the series
   is absent, not zero-valued.

**Kill** (would invalidate the work):
- If any existing alert already covers an absent producer via `absent_over_time()` — it does
  not (confirmed grep-clean).
- If Prometheus target discovery uses push-gateway semantics that persist series on pod
  delete — it does not (confirmed `kubernetes_sd_configs role:pod` pull-based discovery).

### R-4: Coherence Surface Wire

The `freeside-coherence` Next.js explorer currently reads fixtures. For P0, the minimum
bar is that `SeamNftMintDetectedSilent`'s **firing state** is readable from the coherence
surface — either via a Prometheus query the explorer makes or via a documented API endpoint
that the explorer calls. The explorer MUST NOT be left reading a fixture that ignores the
new alert. If the wire to live Prometheus data is blocked by a prerequisite out of scope for
P0, that blocker must be documented explicitly as a BLOCKER in the sprint plan with a named
owner.

The operator reads the coherence output WITHOUT being told to look. If the alert fires and
the operator only discovers it by checking Prometheus directly, R-4 is not satisfied.

---

## Assumptions

| # | Assumption | Risk if wrong |
|---|------------|---------------|
| A-1 | The Rust gateway (`apps/gateway`) is the correct publisher motor-edge in loa-freeside scope. The `nft.mint.detected.v1` seam is published by **freeside-sonar** (external repo) — NOT by the Discord gateway. The counter pattern added here to the gateway covers Discord-sourced events (`commands.*`, `events.guild.*`, `events.member.*`). For the alert to fire on `nft.mint.detected.v1`, sonar's NATS publisher must also emit `gateway_events_published_total{subject}` (or a sonar-equivalent counter). This is a P1 concern unless sonar routes through the gateway. | If sonar does not adopt the same counter pattern, the `nft.mint.detected.v1` alert will permanently fire (absent series) rather than fire only on silence. The kill/prove test must account for this: use a seam the gateway DOES publish to prove the mechanism, then accept that `nft.mint.detected.v1` requires sonar instrumentation before the alert is operationally meaningful. |
| A-2 | The `metrics` crate (`use metrics::{counter, ...}` in `metrics/mod.rs:5`) supports the `subject` label dimension without code changes to the `PrometheusBuilder` setup (`metrics/mod.rs:20-30`). New labels are additive in the `metrics_exporter_prometheus` crate. | If the exporter is configured with a cardinality cap that rejects new label dimensions, the counter silently drops. Verify during implementation. |
| A-3 | The 30-minute cadence window is conservative enough that `nft.mint.detected.v1` fires on a real silence (not a false positive during low-volume periods). The cluster's sonar indexes Berachain events; if NFT mint activity is seasonal, the window may need adjustment. | False positives during genuine low-activity windows erode alert trust. The SDD should state expected cadence with evidence. |
| A-4 | `freeside-coherence` can consume a live Prometheus query or alert-manager API within the P0 sprint. The context brief (`building-membrane-baseline.md:38`) confirms it is live but reads fixtures. | If the coherence explorer has no live Prometheus data path, R-4 requires a new integration that may exceed P0 scope. Surface as a BLOCKER if true. |
| A-5 | The `for: 0m` initial setting on the alert is appropriate for kill/prove testing. Production deployment may adjust to `for: 5m` to filter transient absent windows during rolling deploys. | A `for: 0m` in production produces alert noise during normal pod restarts. The SDD must specify the production value explicitly. |
| A-6 | `nft.mint.detected.v1` (the base versioned subject, no collection specifier) is the correct subject key for the alert — not a collection-specific form like `nft.mint.detected.mibera-shadow.v1`. The base form (`nftMintDetectedTopic()`, `topics.ts:75`) is the aggregate cadence seam. | If sonar publishes only collection-specific subjects, the alert must use `absent_over_time(sum(gateway_events_published_total{subject=~"nft.mint.detected.*"})[30m])` or the wildcard form. Clarify against sonar's publish path in the SDD. |

---

## Acceptance Criteria

### P0 Counter

- [ ] `gateway_events_published_total` is declared in `apps/gateway/src/metrics/mod.rs` with a `subject` label dimension (parallel to the existing `describe_counter!` calls at lines 35–54)
- [ ] The counter is incremented in `apps/gateway/src/nats/publisher.rs:publish_event` at the JetStream ACK success path (after `ack_future.await` returns `Ok(ack)`, currently at the code block opened by line 127)
- [ ] The existing `self.messages_published.fetch_add` (publisher.rs:128) is preserved unchanged — the new Prometheus counter is additive
- [ ] The counter appears in the `/metrics` endpoint output after a successful publish (verified via the `GatewayMetrics::render()` path at `metrics/mod.rs:178`)
- [ ] No existing counter or test is broken (cargo test passes clean)

### P0 Alert

- [ ] `infrastructure/observability/prometheus/alerts.yml` contains a new group `arrakis-seam-cadence`
- [ ] The group contains at minimum `SeamNftMintDetectedSilent` using `absent_over_time()`
- [ ] The alert carries the `seam: nft.mint.detected.v1` label for coherence surface filtering
- [ ] The YAML parses and validates via `promtool check rules alerts.yml` with exit 0
- [ ] Zero existing alert rules are modified (additive only)

### P0 Kill/Prove

- [ ] The prove procedure is documented (inline or linked runbook): pause publisher → `SeamNftMintDetectedSilent` fires within 30m window
- [ ] The prove procedure documents that `GatewayShardDown`, `GatewayNATSPublishFailures`, and other existing threshold rules do NOT fire during the same pause (series absent, not zero)
- [ ] If A-1 is true (sonar publishes `nft.mint.detected.v1`, not the gateway), the kill/prove uses the gateway's own published seam to prove the mechanism, with a documented note that `nft.mint.detected.v1` requires sonar instrumentation to be operationally complete

### P0 Coherence Surface

- [ ] The `SeamNftMintDetectedSilent` alert's firing state is readable from freeside-coherence explorer without the operator navigating directly to Prometheus
- [ ] If a live Prometheus data path does not exist in the explorer, a BLOCKER bead is filed with a named owner before the sprint is marked done — the loop is not closed until the operator can see the signal

### P0 Reversibility

- [ ] All changes are additive: no existing metric, alert, or routing logic is removed or modified
- [ ] A single `git revert` of the P0 commit(s) restores the prior state completely

---

## Out of Scope / Deferred

- **P1 membrane fields**: BeaconV3 `membrane` field, `ts-morph` extractor, `freeside-cli graph dump`, `doctor.ts checkMembrane`, cross-field race fixture — all deferred to next cycle per operator instruction
- **Sonar instrumentation**: adding `gateway_events_published_total{subject}` (or equivalent) to freeside-sonar's NATS publisher is a prerequisite for the `nft.mint.detected.v1` alert to be operationally meaningful; it is out of scope for loa-freeside P0 but must be tracked
- **Fail-block teeth**: flipping the alert severity to `critical` or adding an automated circuit-break is deferred; report-only first
- **Fan-out to other seams**: `parallel.mode.enabled.v1` and any future seams added to `packages/events/src/topics.ts` — pattern proven on one seam first
- **Alert Manager routing**: configuring which channel/page receives `SeamNftMintDetectedSilent` is infrastructure-team scope, not this PRD

---

## References

| Source | Path | Use |
|--------|------|-----|
| Gateway metrics module | `apps/gateway/src/metrics/mod.rs` | Counter addition site |
| Gateway NATS publisher | `apps/gateway/src/nats/publisher.rs:107-155` | Publish motor edge; increment site |
| Event topics | `packages/events/src/topics.ts:75-85` | Canonical `nft.mint.detected.v1` subject |
| Prometheus alerts | `infrastructure/observability/prometheus/alerts.yml` | Alert addition target; zero absent_over_time confirmed |
| Building membrane baseline | `grimoires/loa/context/2026-06-03-building-membrane-baseline.md` | INV-3 classification, coherence surface state |
