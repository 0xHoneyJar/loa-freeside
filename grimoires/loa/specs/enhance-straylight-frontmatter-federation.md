---
title: "Session 5 — Straylight Frontmatter Federation"
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
confidence: 0.50
decay_class: working
last_confirmed: 2026-06-03
---

# Session 5 — Straylight Frontmatter Federation

> Every decision we make becomes recallable, governed, and trustworthy — so the next
> session inherits a truth-state, not a pile.

## Context

The org has **five fragmented vocabularies that describe the same primitive** — a governed claim
about the system with provenance + a status lifecycle + a use-label: Straylight Assertions,
Hounfour schemas, flat Freeside ADRs (no frontmatter), construct TDRs, and hivemind labels
(in four un-deduped copies). None admit through one envelope. This cycle **federates them through
one governed envelope so `/recall` surfaces a single truth-state**, ranked by trust.

The intention is the spine: Straylight keeps the force-chain (observation→memory→belief→
instruction→action→commitment→permanence) from collapsing — each promotion needs an explicit act
or gate; recall is read-only; the agent never self-promotes. This federation applies that
discipline to our artifacts. It's the continuity substrate — "helping me help you."

**The 3-way split (do NOT violate):** AUTHORITY = Hounfour (canonical schema everyone pins to) ·
LIFECYCLE = Straylight (admit/contest/revoke) · SURFACING = hivemind lab (labels/projection).
Put authority in the lifecycle layer and you rebuild the archived archivist.

## Run via — `immune-relay-recall` (REQUIRED)

@~/bonfire/construct-compositions/compositions/*/immune-relay-recall.yaml
→ the doctor→stamp→teeth loop on the recall estate: **doctor** (estate-doctor surfaces unstamped
artifacts, loud) → **stamp** (frontmatter-stamp.sh brings them to contract, operator-gated) →
**teeth** (the conformance test + a CI gate refuse new ungoverned artifacts). The operator directs
at the stamp gate (never auto-promote — the force-chain has teeth). For the code steps (recall.sh
extension + the conformance test), compose `code-implement-and-review` within.

## Load Order

1. `~/bonfire/construct-compositions/compositions/*/immune-relay-recall.yaml` — the driving loop
2. `grimoires/loa/context/2026-06-03-construct-membrane-doctrine.md` — the taxonomy verdict + GAP A (the canonical reasoning; clew=correction channel, TDR/ADR=decision channel, both admit through one envelope)
3. `~/.claude/scripts/straylight-estate/frontmatter-stamp.sh` — the stamp primitive (reuse, do NOT reinvent)
4. `~/.claude/scripts/straylight-estate/recall.sh` — the consumer to extend (the `scan_md` source list)

## Persona

TEND (cycle) + the estate-immune discipline. KEEPER/observer lens (governance) + KRANZ (the
load-bearing artifact is the runbook; distill at the end).

## Invariants (must not change)

- **Reuse the stamp tool.** `frontmatter-stamp.sh` is idempotent + non-destructive (adds contract
  keys, never removes). Do not write a second stamper.
- **Consumer-first.** `recall.sh`'s markdown `fm()` reader IS the consumer. Federate INTO it. Do
  NOT build a JSONL admit pipe nobody reads (the GAP-A lesson — that was killed as void).
- **`trust_tier` ≠ `provenance.source_type`.** trust_tier is the *trust* axis recall ranks on
  (operator-validated > operator-authored > ai-derived > ai-autogen); source_type is the *origin*.
  Keep them decoupled (the stamp tool already does).
- **Recall stays read-only.** Stamping sets defaults (`read_state: unread`, `use_label:
  use_as_background_only`, `confidence: 0.50`); PROMOTION (bumping read_state/confidence) is a
  separate operator act. The agent never self-promotes.

## What to Build (in order)

### 1. The conformance gate — loa-constructs#254 (toothed first move)
The clew vocabulary (`learnings-construct.schema.json`) ↔ the Straylight frontmatter enums
(`frontmatter-stamp.sh`'s `read_state`/`use_label`/`confidence`/`decay_class`). A ~15-line test
asserting they have NOT silently diverged. Pins two of the five vocabularies to one enum set
*without building the admit pipe nobody consumes*. (Already filed: loa-constructs#254.)

### 2. Extend recall's reach — `recall.sh` (the load-bearing fix)
`recall.sh` scans auto-memory + vault + observations — **but not `decisions/` or
`grimoires/loa/context|specs/`.** Add a `decision-records` source that `scan_md`'s the active
repo's `decisions/*.md` + `grimoires/loa/{context,specs}/*.md`. This is *why* stamping alone
federates nothing today. Trust-weight them by their stamped `trust_tier` like every other source.

### 3. Stamp the artifacts + prove the consumer (the live payoff)
Run `frontmatter-stamp.sh` across loa-freeside `decisions/*.md` (currently ZERO frontmatter) +
`grimoires/loa/context/*.md` + `specs/*.md` (inconsistent: 4–11 fields). Then **prove it**:
`/recall "what did we decide about X"` must now surface ADRs + briefs + assertions in ONE governed
pack, ranked by trust. The proof is complete only when the operator sees a decision recalled
across artifact types without being told where it lives.

### 4. Fan out cross-repo (the construct TDRs)
`/coord` into the construct repos to stamp their `grimoires/<construct>/tdr/*` (the recording-taste
output) to the same contract. One repo at a time; the stamp tool is idempotent.

### 5. (Deferred — name the trigger, don't build early)
- **Hounfour authority**: register the canonical artifact-envelope schema once a real cross-repo
  recall need is proven (consumer-first). This is where the archivist IOU finally lands — as a
  Straylight-conformant schema in Hounfour, NOT a new substrate.
- **hivemind surfacing**: de-dup the four `labels.schema.json` copies into one canonical home.

## Design Rules

- Stamp is additive: never remove an existing key; the tool's defaults are a floor, not a ceiling.
- A decision artifact's `source_type` is the channel: ADR/TDR = `operator-authored` or `ai-derived`
  (the DECISION channel); a clew = `operator-correction` (the CORRECTION channel). Both admit
  through the one envelope.
- The CI teeth (step 1's test wired to fail-block) come AFTER the doctor is trusted — doctor (loud)
  → stamp (gated) → teeth (fail-block), in that order. Never teeth-first.

## What NOT to Build

- NO new memory substrate / admit pipe / JSONL ingestion (the archived-archivist over-reach + the
  GAP-A void). The consumer is the existing markdown reader.
- NO authority in Straylight or hivemind — authority is Hounfour. NO lifecycle in Hounfour —
  lifecycle is Straylight.
- NO auto-promotion. The stamp sets `unread`/`background_only`; the operator promotes.

## Verify

- `/recall "what did we decide about <topic>"` federates ADRs + TDRs + briefs + assertions in one
  trust-ranked pack (was: ADRs/briefs invisible to recall).
- The conformance test (step 1) passes; `estate-doctor.sh` shows the stamped artifacts at contract.
- `git diff` on the stamped `.md` files shows ONLY additive frontmatter (no body changes).

## Key References

| Topic | Path |
|---|---|
| Taxonomy verdict + GAP A | `grimoires/loa/context/2026-06-03-construct-membrane-doctrine.md` |
| Stamp tool | `~/.claude/scripts/straylight-estate/frontmatter-stamp.sh` |
| Recall (extend its sources) | `~/.claude/scripts/straylight-estate/recall.sh` (the `scan_md` list ~line 71-78) |
| Conformance test (filed) | loa-constructs#254 |
| Eileen's lineage (authority ladder) | this session's memory: `project_building-membrane-baseline` + the lineage synthesis |

## Review provenance + Open operator decisions

- **Hardened in-session** (the dig + grounding ran live: stamp tool verified, recall source-gap
  verified at recall.sh:71-78, ADR frontmatter confirmed zero, the 3-way split grounded in Eileen's
  RecallWedgeBoundaryOwner lanes). Not a separately-flatlined doc — the grounding is the hardening.
- **Open decision 1 — recall source scope**: does the new `decision-records` source scan ONLY the
  active repo's `decisions/` + `grimoires/loa/{context,specs}/`, or federate cross-repo too?
  (Recommend active-repo first; cross-repo via the per-repo recall silos already federated.)
- **Open decision 2 — when does Hounfour authority land?** Consumer-first says: only after step 3
  proves a real cross-artifact recall need. Operator confirms the trigger.
- **Adjacent (NOT this cycle)**: the `spiral-evidence.sh` breaker fix (CI-deferred evidence
  false-negative) — precondition for the P0/P1 spiral; and the building-heartbeat → status-page
  cycle. Three distinct threads; this is the federation only.
