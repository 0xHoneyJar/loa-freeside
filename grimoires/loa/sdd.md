# Software Design Document — Hexagonal Extraction Migration

> **Cycle:** extraction-migration · **PRD:** `grimoires/loa/prd.md` (Flatline-hardened, 9 FRs) ·
> **Spine:** dependencies-to-the-edge / port-in-platform-runtime-in-building (`construct-honeycomb-substrate`).
> Date: 2026-06-21 · (Prior `sdd.md` — Asson — preserved alongside.)

## 1. Architecture — the honeycomb four-folder, made operational

The target shape is the **`domain / ports / live / mock`** four-folder (ECS≡Effect≡Hexagonal≡Honeycomb),
with the **dependency rule** enforced: source dependencies point **inward** only.

```
PLATFORM (loa-freeside) — the pure, deferred core + the substrate
  packages/core/
    domain/*.ts          pure schema records / value objects (no deps)
    ports/*.port.ts      the Service Tag / interface — the SEAM (dependency-free contract)
  packages/{adapters,sandbox}/, apps/{gateway,worker,ingestor,mcp-gateway}/, infrastructure/terraform/
        ↑ depends-inward only (lint-enforced, FR-7)
BUILDINGS (*-api repos) — the edge, where deps + runtimes live
  <cap>-api/  lib/live/*.live.ts   Layer.succeed(Tag, …) — runtime + I/O + deps
              lib/mock/*.mock.ts   test doubles
WIRING: one single-effect-provide-site (the boot) composes the Layers — the dependency root, at the edge.
```

**Extraction = split, not move:** the `.port` (Tag) **stays** in `packages/core/ports`; the `.live`
(Layer.succeed + deps) **moves** to `<cap>-api`. Callers route through the `.port` (FR-6), so swapping the
`.live` provide-site (monolith → building, via BeaconV3/NATS seam) is transparent. Extraction is
**delete-heavy** — the monolith `.live` leaves once the building consumer is verified (FR-3).

## 2. Components / Mechanisms (the MVP design)

### 2.1 FR-0 — root-cause classifier (the rubric) — **BUG-FIRST predicate order (Flatline IMP-006/SKP-002)**
Evaluated in **strict order** so a real bug can never be hidden as STRANDED:
1. **BUG (checked FIRST)** — the failure reproduces **deterministically** (3× same result) against the
   *current* in-platform runtime AND asserts a real invariant (treasury-conservation, auth, balance). →
   **FIX. Never quarantine, regardless of folder.** A conservation/auth/balance assertion is BUG-eligible
   by definition.
2. **FLAKY** — non-deterministic across ≥3 runs (Redis/timeout/shared-state). → stabilize or quarantine-flaky.
3. **STRANDED** (only if NOT bug, NOT flaky) — a `port↔live` mid-flight artifact: the assertion targets a
   runtime whose `.live` provide-site is partially extracted. → MOVE-LIVE-quarantine.
The capability→destination input comes from the **executable extraction manifest** (§2.3a), not prose.
Each classification is recorded with its evidence (the 3-run output) in the quarantine manifest.

### 2.2 FR-1 — quarantine WITH TEETH + **ACTIVE SURFACING (Flatline SKP-001/003 CRITICAL, IMP-002/011)**
The flaw a non-required check has — *silent in auto-merge* — is fixed by making the **governance** required
even though the quarantined *tests* aren't:
- **Mechanism:** a 4th vitest project `quarantine`. The required `Unit/Integration Tests` exclude
  manifest-listed files; a `quarantine` job **runs them and reports**.
- **REQUIRED quarantine-gate** (`tools/quarantine/gate.sh`, wired into `pr-validation.yml` as a **required**
  check): **fails the PR** if any entry is (a) **past `expiry`** (hard TTL — no open-ended quarantine), (b)
  missing owner/evidence, or (c) **newly failing a *different* assertion** than its recorded STRANDED
  signature (a quarantined test that starts asserting a NEW failure = a possible regression → escalate, not
  hide). This gate is the teeth; the test-exclusion is the convenience.
- **Active surfacing:** the `quarantine` job posts a **PR-comment digest** every PR (cluster, owner, days-to-
  expiry, red/green) — "signal kept" means *visible*, not just *runnable*.
- **Manifest:** `themes/sietch/tests/quarantine.manifest.json` — `{ file, cluster, disposition:"STRANDED",
  destination, owner, expiry, stranded_signature, evidence, bead }`.
- **Lifecycle:** deleted here **only** when the extraction lands + the building suite covers it (FR-3).

### 2.3 FR-6 — caller/import inventory + port-routing
- **Inventory script** (`tools/extraction/caller-inventory.mjs`): for a capability, list every importer of
  the concrete `.live`/service vs the `.port`. Direct-`.live` importers are the entanglement (the reason
  tests are mid-flight).
- **Port-routing** is the actual extraction work: route direct importers through the `.port` Tag at the
  single provide-site. This *is* the G-5 inversion — done before the `.live` moves.
- **Enforceable gate (Flatline IMP-008):** the inventory emits a structured artifact; CI fails if any
  direct-`.live` importer remains for a capability marked `port_routed: true` in the extraction manifest.

### 2.3a Extraction manifest — the executable SoT (Flatline SKP-002/IMP-008)
`tools/extraction/extraction-manifest.yaml` is the **single source of truth** that FR-0, FR-6, and the
quarantine gate all read (replaces the prose table in PRD §4): per capability `{ name, port, live_paths[],
destination:"<cap>-api", phase, port_routed:bool, consumer_verified:bool, status }`. Disposition logic and
gates consume this file — no human-prose table drives automation.

### 2.4 FR-7 — dependency-rule lint (owns G-5)
- **Two layers:** (a) eslint `no-restricted-imports` rule scoped to `packages/core/**` forbidding
  `adapters|services|themes` specifiers (fast, in-editor); (b) a CI script `tools/lint/dep-rule.sh`
  (grep/ts-morph over `packages/core`'s import graph) as the authoritative gate — fail the PR on any
  inward→outward edge. Wired into `pr-validation.yml` as a required check.

### 2.5 FR-3 / FR-3a — ledger split (Phase-1, the dependency root)
1. **FR-3a audit/reconcile — with BALANCE-PARITY PROOF (Flatline SKP-001 CRITICAL, IMP-001/005):** diff
   `ledger-api` (the G3 member-ledger substrate) against the monolith `packages/services` ledger. Because
   this is **financial** state, "reconcile to one impl" is gated on a **golden-dataset replay**: run an
   identical transaction sequence through both impls and assert **balance-conservation equivalence**
   (every account balance + the conservation invariant match to the micro-unit). Define **persistence
   ownership** explicitly (which DB/table is canonical). Provide an **abort/escalation path**: if parity
   fails, halt the extraction and escalate — do NOT delete either impl. DoD = parity-proven single impl +
   persistence owner named + callers routed.
2. **Port:** define/keep `ILedger` in `packages/core/ports`; route callers (FR-6).
3. **Provide-site swap — seam failure-modes specified (Flatline SKP-003/004, IMP-004):** moving the ledger
   `Layer.succeed` from an in-process Layer → a `ledger-api` BeaconV3/NATS seam is **not** transparent —
   it adds network failure modes. Specify: **timeout** (bounded), **retry** (idempotent ops only),
   **fallback** (read-through to the still-deployed monolith during the window), **partial-deploy** handling,
   **message-compat** (versioned envelope), and **rollback** (flip the provide-site back). The monolith stays
   the fallback until step 4 passes.
4. **Verify (FR-3/FR-4) — measurable load-bearing gates (Flatline IMP-003):** `ledger-api` suite covers the
   moved behavior; the building is a **named live consumer** with measurable traffic (not just "deployed") —
   `loa census --graph` + coherence probe + a non-zero consumed-edge. **Then** delete the monolith `.live` + tests.

## 3. Data Models / Contracts
- Ports are TypeScript interfaces / Effect `Context.Tag`s in `packages/core/ports/*.port.ts`
  (`IBillingProvider`, `ILedger`, the medium port). Domain types in `packages/core/domain/*.ts`.
- Cross-building contracts ride **BeaconV3** (the belt protocol). **Contract-compat mechanism (Flatline
  IMP-009/010):** `tools/contracts/snapshot.sh` captures each port's BeaconV3 schema; a CI diff fails the PR
  on a breaking change **without** a SemVer major bump; the version + a consumer-impact note are required in
  the extraction PR. Makes the compatibility guard executable, not aspirational.

## 4. Security & Firewall
- ADR-007 firewall (CI-enforced): one domain per PR; commit scopes; beads domain labels. Extraction PRs are
  `shared` or per-building scoped.
- **Open decision-gate (IMP-007, Phase-0):** security/MFA (`packages/adapters/security`, `NaibSecurityGuard`)
  — platform's own auth (stays, FIX-PLATFORM) vs a runtime belonging to `identity-api` (the auth building).
  SDD default: **stays-platform** unless the caller-inventory (FR-6) shows it's an identity-runtime concern.

## 5. Scalability / NFR / End-State
- **End-state (G-3):** `loa-freeside` = thin substrate — `apps/{gateway,worker,ingestor,mcp-gateway}` +
  `infrastructure/terraform` + `packages/{core,adapters,sandbox}` + the `.port`s. No building `.live` in
  `themes/sietch` / `packages/services`.
- **Service-continuity (FR-3, SKP-002):** the monolith runtime stays deployed/consumed until the building
  consumer is verified — shadow-read-then-graduate, no gap.
- **Verification loop:** every landing re-runs `loa census --graph` (the legible map shipped this session).

## 6. Sequencing (informs the sprint)
- **Phase 0:** FR-0 root-cause the ~70 failures → manifest; resolve the security/MFA gate.
- **Phase 1 (MVP):** FR-1 quarantine-with-teeth (proven-STRANDED only) + FR-2 fix the platform-stays slice +
  FR-7 dep-lint + FR-6 caller-inventory + FR-3 Phase-1 ledger split (FR-3a audit → route → swap → verify → delete).
- **Phase 2+ (later cycles):** billing (create `billing-api`) → mediums-residuals (`mediums-api`).

## 7. Risks (design-level)
- Root-cause mis-classification (a BUG labeled STRANDED → masked). Mitigation: FR-0 requires the BUG check
  (deterministic repro against current runtime) before STRANDED; the quarantine job still reports it red.
- `ledger-api` reconciliation larger than a move. Mitigation: FR-3a audit is Phase-1 task 0, time-boxed.
- Lint false-positives blocking legit core code. Mitigation: the rule is import-path-scoped; allowlist
  `packages/core/domain` ↔ `ports` intra-core edges.

> **Sources:** PRD `grimoires/loa/prd.md` (FR-0..FR-7); `construct-honeycomb-substrate` README (four-folder,
> single-provide-site, delete-heavy); `reality/architecture-overview.md`; `themes/sietch/vitest.workspace.ts`
> (3 projects → +quarantine); `themes/sietch/package.json` (eslint present); ADR-007/008/009; this session's
> CI triage (`arrakis-yp7q`) + `loa census --graph`.
