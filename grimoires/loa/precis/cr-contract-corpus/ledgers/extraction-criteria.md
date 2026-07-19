# Extraction criteria — CR contract corpus (S1, manual mode)

run_mode: manual · taint: fixture-simulated
Scope authority: S0 ruling 2026-07-19 (operator zksoju). Criteria govern which
candidate claims S2+ extraction passes MUST admit into the disposition
inventory. Completeness = every admitted candidate carries exactly one
disposition (carried / merged / deferred / excluded-with-reason / backgrounded /
judged-non-load-bearing / unresolved).

## Admit as candidate claims

1. **Contract invariants** — any stated MUST/NEVER/atomicity/idempotency/
   ordering/uniqueness property of a CR protocol surface (schema field,
   endpoint, gate, envelope, ledger, custody rule). Cite `path:line @ af064179`
   or PR/commit id.
2. **Design rationale** — any "because/so that/prevents/otherwise" statement
   explaining WHY an invariant exists (commit bodies, PR bodies, briefs,
   ADR-009, #473).
3. **Rejected alternatives** — any considered-and-rejected design (esp. from
   Bridgebuilder review threads and coordinator iteration deltas f09.19→f09.35).
4. **Boundary decisions** — what was deliberately kept OUT of a contract
   (Gate Leak ratification #478, recognition-only lifecycle #499, boundary
   acceptance #473).
5. **Versioning/compat commitments** — v1.0.0 freeze semantics, compat-harness
   guarantees (#480), gate executability (CR-019 #476).
6. **Unresolved tensions** — open questions, TODOs, deferred HIGHs named in
   reviews but not closed by a later commit in the corpus window.

## Do NOT admit

- Consumer implementation detail (ordering runtime internals) unless cited as
  evidence FOR an invariant.
- Review-thread style/nit commentary with no contract consequence.
- Shadow-audit/eligibility lane content (excluded corpus).
- Claims sourced ONLY from Family 5 secondaries (ai-autogen) — such content may
  route an extractor to a primary source but never stands alone.

## Provenance discipline

- Every claim: source id (PR#/commit SHA/blob path:line/brief file) + quote span.
- Review-body content carries `model_output` provenance — admissible as
  rationale evidence, never as authority for acceptance.
- Conflicting claims are BOTH admitted and marked unresolved — normalization
  merges duplicates, never silently drops conviction conflicts.
