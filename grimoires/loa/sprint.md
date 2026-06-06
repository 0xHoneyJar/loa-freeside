# Sprint Plan: Cluster-Coherence Foundation — P0 Seam Cadence Counter + Absent-Series Alert

**Version**: 1.0.0
**Date**: 2026-06-03
**Cycle**: cycle/coherence-foundation
**PRD**: `grimoires/loa/prd.md`
**SDD**: `grimoires/loa/sdd.md`
**Branch**: `cycle/coherence-foundation`
**Mode**: SHIP — report-only, no fail-block teeth this sprint

---

## Overview

| Property | Value |
|----------|-------|
| Sprint | 1 of 1 |
| Duration | ~1 day |
| Scope | P0 only — additive, reversible, single-repo `loa-freeside` |
| Goal | Close INV-3: silence ≠ death for the `nft.mint.detected.v1` seam |
| PRD Goals | G-1, G-2, G-3, G-4 |
| Files touched | 2 Rust source files + 1 YAML + 1 runbook |
| P1 deferred | BeaconV3 membrane, ts-morph extractor, doctor.ts checkMembrane, sonar instrumentation, fan-out |

### Task Sequence

```
T-1 (metrics/mod.rs)
    ↓
T-2 (publisher.rs) ─── both compile-tested together
    ↓
T-3 (alerts.yml) ────── independent of Rust; can overlap with T-1/T-2 review
    ↓
T-4 (kill/prove runbook + execution)
    ↓
T-5 (coherence surface wire — or BLOCKER filed)
```

T-3 is logically independent of T-1/T-2 (YAML, not Rust), but must be present for T-4
execution. T-5 cannot close until T-3 and T-4 are complete.

---

## Known Constraints Before Implementation

**A-1 boundary (hard)**: The `apps/gateway` Rust publisher does NOT publish
`nft.mint.detected.v1`. That subject is owned by `freeside-sonar` (external repo). The
counter added in T-1/T-2 covers the gateway's own subjects: `commands.interaction`,
`events.guild.*`, `events.member.*`. The kill/prove test (T-4) uses `commands.interaction`
to prove the mechanism. The `nft.mint.detected.v1` alert will fire continuously in
production until sonar adopts the counter — this is a P1 gap, not a P0 defect. Document
it in T-3 and record it in T-4.

**A-5 boundary (hard)**: `for: 0m` is correct for kill/prove. Before production
deployment, the alert MUST be changed to `for: 5m` to suppress transient absent windows
during rolling pod restarts. The YAML comment makes this visible. Sprint does not close
without this being noted explicitly in the runbook.

---

## Sprint 1 — P0 Seam Cadence Counter + Absent-Series Alert

### T-1: Counter Declaration — `apps/gateway/src/metrics/mod.rs`

**Description**: Declare the `gateway_events_published_total{subject}` counter in the
`GatewayMetrics` module. Add the `describe_counter!` call to `register_metrics()` and a
`record_publish_success` method on `GatewayMetrics`. This is the single increment surface
for the new counter — all callers use this method, not the `counter!()` macro directly.

**Files**:
- `apps/gateway/src/metrics/mod.rs`

**Changes**:
1. In `register_metrics()` (line 33), append after the existing `describe_counter!` block
   ending at line 54:
   ```rust
   describe_counter!(
       "gateway_events_published_total",
       Unit::Count,
       "Total events published to JetStream by NATS subject"
   );
   ```
2. Add a new method to `GatewayMetrics` (after `record_error`, before `record_heartbeat`):
   ```rust
   /// Record a successful JetStream publish, labeled by NATS subject.
   pub fn record_publish_success(&self, subject: &str) {
       counter!(
           "gateway_events_published_total",
           "subject" => subject.to_string()
       )
       .increment(1);
   }
   ```

**Acceptance Criteria**:
- [ ] `describe_counter!("gateway_events_published_total", ...)` is present in `register_metrics()` — parallel to the four existing `describe_counter!` calls at lines 35–54
- [ ] `record_publish_success(&self, subject: &str)` method exists on `GatewayMetrics`
- [ ] The method uses the global `counter!()` macro (no struct field or dependency injection needed — process-global recorder is already installed at startup)
- [ ] The existing four `describe_counter!` calls (lines 35–54) are unchanged
- [ ] `record_route_success` is NOT modified — it is a distinct instrument at shard granularity per SDD §3.1

**Test Requirements**:
- `cargo test -p arrakis-gateway` passes clean with zero new failures
- `gateway_events_published_total` counter name appears in `GatewayMetrics::render()` output after `record_publish_success` is called (verified in a unit test or via the T-4 `/metrics` endpoint spot-check)
- No existing test for `record_route_success` or `record_event` breaks

**Effort**: XS (< 30 minutes)
**Dependencies**: None
**Risk**: None — purely additive; cardinality ≈ 15 values (A-2 confirmed safe, no exporter cap)

---

### T-2: Publisher Integration — `apps/gateway/src/nats/publisher.rs`

**Description**: Call `record_publish_success` at the JetStream ACK success path in
`publish_event`. The `subject` variable is already in scope at this site (line 108,
`route_event` return). The call fires AFTER `ack_future.await` returns `Ok(ack)` and AFTER
the existing `self.messages_published.fetch_add(1, Ordering::Relaxed)` at line 128. The
existing AtomicU64 counter is preserved unchanged per PRD R-1.

**Files**:
- `apps/gateway/src/nats/publisher.rs`

**Changes**:
1. Determine whether `NatsPublisher` already holds a `GatewayMetrics` reference. Check the
   struct definition and constructor. Two cases:
   - If `NatsPublisher` holds `metrics: GatewayMetrics`: call
     `self.metrics.record_publish_success(&subject)` immediately after line 128
   - If not: add `use metrics::counter;` import and call the macro directly at that site:
     ```rust
     counter!(
         "gateway_events_published_total",
         "subject" => subject.clone()
     ).increment(1);
     ```
2. The increment goes inside the `Ok(ack) =>` arm (line 127), immediately after
   `self.messages_published.fetch_add(1, Ordering::Relaxed)` (line 128)
3. The counter is NOT called in either `Err` arm (lines 137–154) — success counter only

**Acceptance Criteria**:
- [ ] `publish_event` increments `gateway_events_published_total{subject=<actual_subject>}` immediately after the JetStream ACK success (after `ack_future.await` returns `Ok(ack)`)
- [ ] `self.messages_published.fetch_add(1, Ordering::Relaxed)` at line 128 is preserved unchanged
- [ ] The counter is NOT incremented in the `Err(e) =>` arm of `ack_future.await` nor in the outer `Err(e) =>` arm of `self.jetstream.publish`
- [ ] The `subject` value used is the string computed by `route_event(event)` at line 108

**Test Requirements**:
- `cargo test -p arrakis-gateway` passes clean with zero new failures
- `cargo test --test wire_format` passes clean (wire format conformance unaffected)
- Unit test (new, under `#[cfg(test)]` in `publisher.rs`) or T-4 spot-check confirms:
  - Counter increments to 1 after a successful mock publish
  - Counter does NOT increment when `ack_future.await` returns `Err`
- If a unit test is written: it must mock JetStream publish (or use an integration harness)
  without breaking the existing wire_format test suite

**Effort**: XS–S (30–60 minutes depending on `GatewayMetrics` struct access pattern)
**Dependencies**: T-1 (method must exist, or `counter!()` import must be confirmed present)
**Risk**: Low — `subject` is already in scope; this is a one-liner addition in an existing match arm

---

### T-3: Alert Rule — `infrastructure/observability/prometheus/alerts.yml`

**Description**: Append a new alert group `arrakis-seam-cadence` to `alerts.yml`. Zero
existing groups or rules are touched. The alert uses `absent_over_time()` — the INV-3
correctness fix. The `seam:` label dimension is new and enables coherence surface filtering
in T-5.

**Files**:
- `infrastructure/observability/prometheus/alerts.yml`

**Changes**: Append after the `arrakis-redis` group (current end of file, line 290):
```yaml
# =============================================================================
# Seam Cadence Alerts — INV-3 closure (absent_over_time pattern)
# cycle/coherence-foundation · 2026-06-03
# =============================================================================
- name: arrakis-seam-cadence
  rules:
    - alert: SeamNftMintDetectedSilent
      # absent_over_time fires when the series has no data points in the window.
      # KILL/PROVE: for:0m fires immediately on first absent evaluation.
      # PRODUCTION: change to for:5m before deploying — filters transient pod restarts.
      expr: absent_over_time(gateway_events_published_total{subject="nft.mint.detected.v1"}[30m])
      for: 0m
      labels:
        severity: warning
        component: seam
        seam: nft.mint.detected.v1
      annotations:
        summary: "nft.mint.detected.v1 seam has produced no events for 30 minutes"
        description: >
          The nft.mint.detected.v1 cadence seam has been silent for ≥30m. Either
          freeside-sonar stopped indexing, the gateway series is absent (pod
          deleted/crashed), or sonar has not yet adopted the gateway_events_published_total
          counter (P1 prerequisite — see cycle/coherence-foundation PRD A-1).
          absent_over_time fires; == 0 rules cannot. This is the INV-3 correctness
          distinction.
        runbook_url: "https://wiki.internal/runbooks/seam-silence"
```

**Acceptance Criteria**:
- [ ] File contains a new group `arrakis-seam-cadence` appended after all existing groups
- [ ] The group contains exactly one rule: `SeamNftMintDetectedSilent` using `absent_over_time(gateway_events_published_total{subject="nft.mint.detected.v1"}[30m])`
- [ ] Alert carries labels: `severity: warning`, `component: seam`, `seam: nft.mint.detected.v1`
- [ ] Description annotation references the A-1 P1 gap (sonar instrumentation pending)
- [ ] Comment in YAML explicitly states: "PRODUCTION: change to for:5m before deploying"
- [ ] Zero existing alert groups or rules are modified
- [ ] Total rule count in the file increases by exactly 1

**Test Requirements**:
- `promtool check rules infrastructure/observability/prometheus/alerts.yml` exits 0
- If `promtool` is unavailable locally, the PR description documents the check command and CI is the gate
- Manual diff confirms no existing alert text was altered (pure append)

**Effort**: XS (< 20 minutes)
**Dependencies**: None (logically independent of T-1/T-2; ships in the same PR)
**Risk**: None — additive YAML append; `promtool` validates syntax

---

### T-4: Kill/Prove — Runbook Documentation + Execution Record

**Description**: Document the kill/prove protocol per SDD §8 as a runbook. Then execute
the procedure and record the result. This is a required acceptance gate per PRD R-3 — not
optional.

**Test subject (A-1 resolution)**: Kill/prove uses `commands.interaction` — a subject the
gateway publishes on every Discord slash command interaction. The `nft.mint.detected.v1`
alert fires continuously in production (series permanently absent until sonar adopts the
counter); this is expected and documented, not a kill/prove failure.

**Files**:
- `grimoires/loa/runbooks/seam-cadence-kill-prove.md` (new file)

**Runbook must contain**:

1. **Purpose** — what the kill/prove proves: `absent_over_time` fires when a publisher is
   dead; `== 0` threshold rules do NOT fire for the same root cause (INV-3 proof)

2. **Test subject declaration** — `commands.interaction` (not `nft.mint.detected.v1`);
   rationale: gateway does not publish the latter (A-1)

3. **Pre-conditions** — gateway deployed with T-1/T-2 counter; T-3 alert loaded by
   Prometheus; Discord interactions flowing (or test publishes injected via `nats pub`)

4. **Temporary kill/prove alert variant** — for faster iteration, use a locally-applied
   alert expression:
   ```yaml
   expr: absent_over_time(gateway_events_published_total{subject="commands.interaction"}[5m])
   for: 0m
   ```
   After acceptance, revert to `subject="nft.mint.detected.v1"`, `[30m]`, `for: 5m`

5. **Step-by-step procedure**:
   - Baseline: `gateway_events_published_total{subject="commands.interaction"}` present in `/metrics`; `SeamNftMintDetectedSilent` NOT firing
   - Kill: stop gateway pod or block JetStream connection
   - Wait: ≥5m (kill/prove window)
   - Verify fires: `GET /api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}` returns non-empty
   - Verify threshold rules silent: `GatewayShardDown` and `GatewayNATSPublishFailures` do NOT fire during the same window
   - Restore: restart gateway; verify counter resumes; verify alert resolves

6. **Execution record** — timestamps, Prometheus query output (or screenshot), explicit
   confirmation of the simultaneous state proof

7. **P1 gap note** — `nft.mint.detected.v1` alert fires continuously in production
   because sonar is the publisher and has not adopted `gateway_events_published_total`;
   this is an open P1 gap (not a kill/prove failure)

8. **Production deployment note** — `for: 0m` in `alerts.yml` must be changed to
   `for: 5m` before production deployment

**Acceptance Criteria**:
- [ ] `grimoires/loa/runbooks/seam-cadence-kill-prove.md` exists with all 8 sections above
- [ ] Runbook documents that kill/prove uses `commands.interaction`, not `nft.mint.detected.v1`
- [ ] Runbook documents the simultaneous-state proof: `absent_over_time` fires AND `GatewayShardDown` + `GatewayNATSPublishFailures` do NOT fire for the same root cause
- [ ] Runbook documents the `nft.mint.detected.v1` P1 gap — continuously-firing alert is expected, not a defect
- [ ] Runbook documents the `for: 0m` → `for: 5m` production change obligation
- [ ] Execution result (timestamps + query output or screenshot) is recorded before this sprint is marked done

**Test Requirements**:
- Execution record must show both conditions simultaneously: `SeamNftMintDetectedSilent` fires AND `GatewayShardDown` / `GatewayNATSPublishFailures` do NOT fire
- If a live Prometheus environment is unavailable: procedure is fully documented and marked "pending execution"; sprint may close with a BLOCKER bead filed for the execution gate — do NOT skip the runbook write

**Effort**: S (1–2 hours including write-up and execution)
**Dependencies**: T-1, T-2 (counter must be emitting), T-3 (alert must be loaded by Prometheus)
**Risk**: Medium — requires access to a live Prometheus + gateway environment; if unavailable, execution is deferred with a BLOCKER bead

---

### T-5: Coherence Surface Wire

**Description**: Wire `SeamNftMintDetectedSilent`'s firing state into the
`freeside-coherence` Next.js explorer so the operator sees the seam's health without
navigating to Prometheus. The explorer currently reads fixtures; this task replaces that
fixture read with a live Prometheus HTTP API query filtered by `seam: nft.mint.detected.v1`.

This task has a change owner in `freeside-coherence` (external repo). The sprint plan
owner is responsible for filing the BLOCKER if the wire cannot be completed.

**Implementation approach** (per SDD §3.4):
- Prometheus query: `GET {PROMETHEUS_URL}/api/v1/alerts`, filter response for
  `labels.seam == "nft.mint.detected.v1"`
- OR: `GET {PROMETHEUS_URL}/api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}`
- Explorer converts to binary signal: green (inactive) or red (firing)
- Error / non-200 must render explicit "data unavailable" — NOT silently green (SDD §6.5)
- `PROMETHEUS_URL` is a build-time env var in `freeside-coherence`
- No changes to `loa-freeside` are required for this wire

**BLOCKER gate** (per PRD R-4 and SDD §3.4): If the live Prometheus data path cannot be
wired before this sprint closes, a BLOCKER bead must be filed with:
1. The specific prerequisite blocking the wire
2. A named owner
3. A reference to this sprint (`cycle/coherence-foundation`)

The sprint cannot be marked DONE while `SeamNftMintDetectedSilent` is only discoverable
via Prometheus directly.

**Acceptance Criteria**:
- [ ] `SeamNftMintDetectedSilent` firing state is readable from `freeside-coherence` explorer without navigating to Prometheus
- [ ] Explorer renders explicit "data unavailable" when Prometheus API call fails or returns non-200
- [ ] Explorer filters by `seam: nft.mint.detected.v1` label (not all alerts)
- [ ] `PROMETHEUS_URL` is configurable via env var; fixture read is replaced or gated
- [ ] **OR**: BLOCKER bead is filed in `freeside-coherence` with a named owner before this sprint closes

**Test Requirements**:
- Verify: when `SeamNftMintDetectedSilent` is firing, coherence explorer shows red for the `nft.mint.detected.v1` seam
- Verify: when the alert is inactive, explorer shows green
- Verify: when `PROMETHEUS_URL` is unreachable, explorer shows "data unavailable" (not green)
- If wired: a smoke test confirming the Prometheus query path works end-to-end (can be manual)
- If deferred to BLOCKER: verify the BLOCKER bead exists with correct labels and named owner

**Effort**: S–M depending on `freeside-coherence` current state (external repo; M if Prometheus auth or a new API route is needed)
**Dependencies**: T-3 (alert must exist for the live query to return meaningful state)
**Risk**: High — external repo; wire may require a Prometheus auth prerequisite or new API route. File the BLOCKER promptly; do not discover the gap at sprint close.

---

## Acceptance Criteria Summary (PRD cross-reference)

| PRD Acceptance Criterion | Task | Done |
|--------------------------|------|------|
| `gateway_events_published_total` declared with `subject` label | T-1 | [ ] |
| Counter incremented at JetStream ACK success path | T-2 | [ ] |
| `self.messages_published.fetch_add` preserved unchanged | T-2 | [ ] |
| Counter appears in `/metrics` after successful publish | T-2 + T-4 | [ ] |
| `cargo test` passes clean | T-1, T-2 | [ ] |
| `alerts.yml` contains new group `arrakis-seam-cadence` | T-3 | [ ] |
| `SeamNftMintDetectedSilent` uses `absent_over_time()` | T-3 | [ ] |
| Alert carries `seam: nft.mint.detected.v1` label | T-3 | [ ] |
| `promtool check rules` exits 0 | T-3 | [ ] |
| Zero existing alert rules modified | T-3 | [ ] |
| Kill/prove procedure documented | T-4 | [ ] |
| Kill/prove proves threshold rules do NOT fire during publisher pause | T-4 | [ ] |
| A-1 gap documented (sonar P1 prerequisite) | T-3, T-4 | [ ] |
| `for: 0m` → `for: 5m` production obligation documented | T-3, T-4 | [ ] |
| `SeamNftMintDetectedSilent` firing state readable from coherence explorer | T-5 | [ ] |
| BLOCKER bead filed if coherence wire is blocked | T-5 | [ ] |
| All changes additive; single `git revert` restores prior state | All | [ ] |

---

## Deferred to P1

These are out of scope and must not be implemented in this sprint.

| Item | Reason deferred |
|------|----------------|
| `gateway_events_published_total` in `freeside-sonar` | Sonar is external; P1 prerequisite for `nft.mint.detected.v1` alert to be operationally meaningful |
| BeaconV3 `membrane` field schema | Operator instruction |
| `ts-morph` AST membrane extractor | Operator instruction |
| `freeside-cli graph dump` + `doctor.ts checkMembrane` | Operator instruction |
| Cross-field race fixture (sealed_schema ↔ cluster.eventsPin) | Operator instruction |
| Fan-out to `parallel.mode.enabled.v1` and future seams | Pattern proven on one seam first |
| Fail-block teeth (severity escalation, automated circuit-break) | Report-only this sprint |
| Alert Manager channel routing | Infrastructure-team scope |
| `for: 0m` → `for: 5m` in production | Done at deploy time, not in this sprint's YAML |

---

## References

| Source | Path | Notes |
|--------|------|-------|
| PRD | `grimoires/loa/prd.md` | Requirements; R-1 through R-4, acceptance criteria |
| SDD | `grimoires/loa/sdd.md` | Design; §3.1–3.4, §8 kill/prove protocol |
| Gateway metrics | `apps/gateway/src/metrics/mod.rs` | T-1 change site; `register_metrics()` at line 33; four existing `describe_counter!` calls at lines 35–54 |
| Gateway publisher | `apps/gateway/src/nats/publisher.rs:107–155` | T-2 change site; `publish_event` ACK success path; `fetch_add` at line 128 |
| Prometheus alerts | `infrastructure/observability/prometheus/alerts.yml` | T-3 change site; `arrakis-redis` group is current end-of-file |
| Building membrane baseline | `grimoires/loa/context/2026-06-03-building-membrane-baseline.md` | INV-3 classification; coherence surface state |
