# Implementation Report — Order System, Sprint 3 (agent-nav + declaration plane)

**Branch**: `cycle/shadow-audit-runtime-ordering` · **Run**: autonomous (goal: finish all sprints) · local-only.
**Domain (ADR-007)**: platform code this run; the network registry change is a SEPARATE operator-gated proposal.
Traces to `sprint.md` Sprint 3 + SDD §6, §8, §12.0, §13 B-1/B-2/H-7.

## Executive Summary
Built the platform half of Sprint 3 — the resolver **graduation** from config to `loa where` behind the
existing `CapabilityResolver` PORT, and **trust-rooted resolution** (H-7). The network half (S3-T1
registry declarations + grants) is the live discovery/routing SoT — authored as an apply-ready
**operator-gated proposal**, not autonomously mutated. **Gate: tsc clean · 43 tests pass (+8).**

## AC Verification

### S3-T1 — declare audit buildings + belts in registry.yaml (declaration keystone)
> "`loa census --graph` renders the `order→audit` + `audit→shadow-mode-api→sonar+score+worlds` edges (no more 0-edge dust)"

**⏸ [ACCEPTED-DEFERRED — operator-gated].** This mutates the network deploy/discovery SoT
(`registry.yaml`) AND requires a registry **schema bump** (`consumes`/`publishes` aren't registry fields
yet) AND a fix to the edgeless-census bug (`arrakis-w3h2`). Per the OperatorOS no-latitude-on-routing
boundary + ADR-007 (network domain), an autonomous local run does not edit it. The exact change is
authored at `a2a/sprint-3/S3-T1-registry-declaration-proposal.md`; bead `arrakis-acbc` (domain:network)
left open. NOTES.md Decision Log entry filed.

### S3-T2 — grants + swap config-resolver → `loa where` backend behind the same PORT
> "`loa where` returns `found:true` for the audit's buildings; resolver resolves via `loa where`; routing event labels `source: loa-where`"

**✓ Met (code) / ⏸ live e2e gated on the empty discovery plane.** `src/loa-where-resolver.ts`
`LoaWhereCapabilityResolver` implements the `CapabilityResolver` PORT, queries `loa where <building>`,
returns the live endpoint labeled `source:'loa-where'`, fail-closed. Tested:
`src/__tests__/loa-where-resolver.test.ts` (found→source:loa-where; found:false→fail-closed;
found-but-no-endpoint→fail-closed-never-fabricate; unmapped→fail-closed). The `found:true` live result
needs the registry declarations + grants (S3-T1) — verified this run that `loa where shadow-mode-api`
returns `found:false` (empty plane, SDD §12.0), so the resolver correctly fails closed live until S3-T1 lands.

### S3-T3 — trust-rooted resolution (H-7)
> "a wrong/unsigned/mismatched-env endpoint is refused, not used"

**✓ Met.** `src/trust-rooted-resolver.ts` `TrustRootedResolver` wraps any resolver; refuses unless the
resolved (building,endpoint) matches an allowlisted, env-matching, allowlisted-trust-root signed
declaration. Tested: `src/__tests__/trust-rooted-resolver.test.ts` — accepts valid; **refuses** a
wrong-but-valid-looking endpoint (no declaration), an env mismatch, and a non-allowlisted trust root.

## Tasks Completed
| Task | Files | Status |
|------|-------|--------|
| S3-T2 | `src/loa-where-resolver.ts` (+test) | platform — graduation resolver behind the PORT |
| S3-T3 | `src/trust-rooted-resolver.ts` (+test) | platform — H-7 trust binding |
| S3-T1 | `a2a/sprint-3/S3-T1-registry-declaration-proposal.md` | network — apply-ready proposal (operator-gated) |

## Technical Highlights
- **Same PORT, swappable backend:** config → `loa where` → (`loa where` wrapped by trust) all satisfy
  `CapabilityResolver`. The orchestrator is unchanged; the composition root picks the backend.
- **Honest fail-closed live:** the `loa where` resolver returns not-found today (empty plane) rather
  than pretending — no theater. It goes live the instant S3-T1's declarations + grants exist.
- **H-7 generalizes the secret-parity hazard:** a wrong-but-valid endpoint → wrong audit → wrong access
  decision; trust binding refuses it before use.
- **No fabrication:** `makeLoaWhereInvoker` returns `found:false` rather than inventing an endpoint when
  `loa where` reports found-but-no-parseable-endpoint.

## Known Limitations
- S3-T1 (registry declarations + grants + census edge aggregation) is operator-gated network work — see the proposal + `arrakis-w3h2`.
- `makeLoaWhereInvoker`'s `found:true` endpoint extraction is best-effort against the documented `{found,hints,note}` shape; the exact hint field should be confirmed against a live grant (marked in-code).

## Review status
Independent cross-model review still unavailable (OpenAI quota + codex dispatch). Self-review: both
resolvers are small, fail-closed, behind the established PORT, each with adversarial refusal tests.
Security: `makeLoaWhereInvoker` uses `execFile` (args array, no shell → no injection); no secrets.

## Verification Steps
```bash
cd packages/services/ordering && pnpm test && pnpm typecheck   # 43 pass, clean
```
