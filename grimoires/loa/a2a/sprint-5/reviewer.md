# Implementation Report — Asson Cycle 5 (comms gate: 3 independent linters + finn PROPOSAL)
> Cycle 5 of 5 · branch asson-cli-layer/cycle-1 (leave-local) · epic arrakis-jwxt

## Executive Summary
`comms-gate.mjs` screens the competitive-REL comms boundary through THREE INDEPENDENT linters (AS-9/B5) — legal-register (asson's own lexicon-lint), voice (ai-stench), product-vocab (vocabulary-bank) — each a separate process with its own exit; the gate ORs them. **Proven independent**: legal-only trips legal-not-voice-not-vocab, voice-only trips voice-only, vocab-only trips vocab-only; the competitive fixture trips all 3 → BLOCKED. A finn spawn-time CommandPolicy PROPOSAL is handed off (loa-finn, cross-repo). This completes the 5-cycle ladder.

## AC Verification (SDD §7 row 5: "competitive fixture trips all 3 linters independently")
1. **3 independent linters, no orchestration/shared-lexicon** — ✓ `comms-gate.mjs` runs each as a separate process, ORs exits; `cycle5:(a)` all 3 flag → BLOCKED.
2. **Independence** — ✓ `cycle5:(b)×3`: legal-only/voice-only/vocab-only each trip ONLY their own linter.
3. **clean → pass; absent linter → skipped-not-passed** — ✓ `cycle5:(c)/(e)` (no silent pass — the ci-sensors-must-not-be-numb rule).
4. **asson owns ONLY the legal register** — ✓ `cycle5:(d)` lexicon-lint standalone; the gate never reaches into the other two's judgment.
5. **NOT a System-Zone hook** — ✓ `cycle5:(f)` scope guard (gate is a package script; hook registration is an operator-gated handoff).
6. **finn PROPOSAL** — handoff `handoffs/2026-06-11-asson-finn-commandpolicy.md` (cross-repo, loa-finn gates it).

## Adversarial Analysis
### Concerns
1. **The bats stubs the 2 external linters** (hermetic, CI-portable). The REAL ai-stench integration was verified MANUALLY (stenchy→exit 1, clean→0); vocab-bank is a construct with no CLI → a stub fills the slot. Real vocab-bank wiring is a follow-up (ASSON_VOCABBANK).
2. **The gate shells out to `~/.claude/scripts/ai-stench`** (System Zone global) — read-only invocation (not editing), env-overridable. Fine.
3. **Exit-code coupling** — the gate maps legal=3, voice=1, vocab≠0 to "flagged". If a linter changes its exit convention, the gate mis-reads. Documented; each linter's convention is its contract.
### Assumption challenged
- **Assumption**: 3 linters with stable independent exit codes. Verified for legal + voice (real) + the stub contract. The independence is structural (separate processes), not assumed.
### Alternative
- One orchestrated linter with a shared lexicon vs 3 independent. The SDD (B5/D-3) MANDATES independence (no shared lexicon, no orchestrator — asson owns only the legal register). The OR-of-separate-processes is the correct shape.

Re-verified: cycle-5 8/8 · cycles 1-4 all green · asson 47 · tsc clean. **117 checks total.**
COMPLETED
