# Threat Model — The Settle Substrate (T0.1)

> Status: v1 · Cycle: settle-substrate · Gate: this document MUST exist before implementation (SKP-012).
> Scope: `packages/settle/` — the shared substrate (tier schema + sync gate + verifier + classifier +
> snapshot + trail) and the first instrument (`deployed-truth`). It does NOT cover consumers that wire
> the gate into their own call-sites (their threat models compose with this one).

## 1. What the substrate is defending

The substrate makes one claim mechanically true: **a high-blast-radius ("must-settle") action cannot
proceed on a merely `claimed` assertion** — it proceeds only on an independently `settled` one, or it
abstains. Everything below is "what would let an attacker (or an honest-but-drifting agent) get a
`claimed` thing treated as `settled`, or skip the gate entirely."

## 2. Assets

| Asset | Why it matters |
|-------|----------------|
| `earned_tier` of a claim | The single bit that gates the action. If forgeable, the gate is theater. |
| The pinned `Bar.sha` | Defines the success criterion. If the producer can move it, it self-grades. |
| `determinism-map.json` (domain→posture) | Decides which domains are must-settle. If mutable, an attacker re-labels `money/**` as `FREE`. |
| The verifier's signing key | Mints `settled` snapshots. Whoever holds it can mint settlement. |
| The append-only decision trail | The audit record. If rewritable, proceed-on-claimed becomes invisible. |
| The gate call-site itself | If bypassable, none of the above matters. |

## 3. Actors / threats (STRIDE-lite)

| # | Actor | Threat | Mitigation (where) |
|---|-------|--------|--------------------|
| A-1 | **Compromised / drifting producer** | Self-reports `tier: settled` on a `claimed` thing; lies *consistently* across summary + sub-fields | Verifier recomputes `earned_tier` from un-forgeable evidence on a code path that does **not** import any producer module; producer's `self_reported_tier` is never read by the gate (SKP-006). `verifier.live.ts` + import-boundary test. |
| A-2 | **Self-grading producer** | Pins its own `Bar.sha` so the criterion matches whatever it produced | Bar Registration Authority: bars pinned by a non-producer party before the run; producer-pinned bars rejected (SKP-002a, T2.2). |
| A-3 | **Map tamperer** | Edits `determinism-map.json` to demote a must-settle domain to `FREE` | Map sha pinned as a constant in `classifier.live.ts`; classifier refuses to construct on mismatch (SKP-003). Unknown/unmatched domain → `FAIL_CLOSED`, never `FREE` (SKP-006). |
| A-4 | **Gate bypasser** | Calls the raw must-settle capability directly, skipping `gate.checkSync` | Raw capability is package-private (`live/_internal/`, no barrel export); the only public path is `gated-facade.ts`, which calls the gate first; an import-boundary test fails if any other module imports the raw capability (SKP-001b). This is the structural teeth for G-2. |
| A-5 | **Async-seam attacker** | Exploits a gate that returns a `Promise` (the action proceeds before the await resolves) | Gate is **synchronous** (`checkSync(): GateDecision`, not `Promise`). Evidence is pre-computed into a signed snapshot during async evidence-prep; the gate only does sync reads + sync signature verification (SKP-001a). |
| A-6 | **Snapshot forger** | Fabricates a `settled` snapshot, or replays a stale one | Snapshots are ed25519-signed over their JCS-canonical bytes; the gate verifies the signature against a **trusted verifier public key** configured at gate init and rejects unknown signers; snapshots carry a TTL/validity window and are rejected past it (SKP-005a, SKP-006). |
| A-7 | **Trail rewriter** | Edits/erases trail rows to hide a proceed-on-claimed | Trail is append-only: each row is one `O_APPEND \| O_WRONLY` write of a small (<4096 B) JCS line, atomic per write on local POSIX fs (SKP-004). The chain attests order; the OS attests append-only. **Hardening swap** (cross-FS / large-record / multi-process contention): SQLite WAL-mode single-writer behind the same `TrailWriter` port — see §6. |
| A-8 | **Dependency-supply-chain attacker** | Poisons a transitive dep to alter canonicalization/hashing/signing | Substrate has **zero runtime dependencies** — JCS, SHA-256, ed25519, and the trail use only Node built-ins (`node:crypto`, `node:fs`). The JCS implementation is a spec-pinned RFC-8785 twin with a vector test (mirrors the existing `events/jcs` ↔ `jcs.sh` cross-runtime identity precedent). Smaller TCB = fewer poisoning surfaces. |
| A-9 | **CI-only-enforcement gap** | Invariants (no-producer-import, no-LLM, gate-unbypassable) hold in CI but a local run skips CI | The invariants are encoded as **in-tree runnable tests** that fail the local `vitest run`, not just CI config — so a local `npm test` catches them too. CI is the second line, not the only line. Residual risk acknowledged in §5. |
| A-10 | **Fable-voice degradation** | A degraded model chain (missing voice / hash mismatch / partial chain) still yields `settled` | The chain-health input to settlement is checked; a degraded-Fable chain cannot reach `settled`/APPROVED (G-7, T2.4 counter-example). |

## 4. Trust boundaries

```
   PRODUCER (untrusted)            VERIFIER (trusted, holds key)         GATE (sync enforcement)
   ───────────────────            ────────────────────────────         ──────────────────────
   emits VerdictEnvelope    ──►    re-executes instrument /       ──►   reads SIGNED snapshot
   with self_reported_tier         verifies hash-chain;                  (sync), verifies sig +
   (NEVER trusted)                 recomputes earned_tier;               trusted key + TTL;
                                   SIGNS a VerificationSnapshot          proceed = earned >= required
```

- The boundary between **producer** and **verifier** is the load-bearing one (A-1/SKP-006): they must
  not share a code path. The import-boundary test is the membrane.
- The boundary between **verifier** and **gate** is the signature: the gate trusts a snapshot iff it
  verifies against the configured verifier key. No key → no `settled` (fail-closed).

## 5. Non-goals / accepted residual risk (this phase)

- **Not** defending a host with root that can patch the running Node process or rewrite the binary —
  out of scope (no in-process integrity attestation this phase).
- **Not** a hardened multi-tenant secret store for the verifier key — the key is provided by the
  embedding environment; rotation/custody is the embedder's job (documented per consumer).
- **Trail cross-process atomicity** beyond the small-record local-POSIX guarantee is **deferred** to the
  SQLite-WAL `TrailWriter` swap; the O_APPEND impl is sufficient for the single-writer agent-session
  case this MVP targets, and the port makes the swap a one-impl change (§6). Accepted, logged in
  NOTES.md Decision Log.
- **Register-before-probe** pre-probe pin (FR-3) is Phase 2 — `deployed-truth` reads at query time; the
  pin seam is added separately, not faked.

## 6. The `TrailWriter` swap (why the port exists)

`SKP-001` (replace raw append with single-writer) and `SKP-004` (use `O_APPEND|O_WRONLY`) are in
tension only for large records / network filesystems / heavy multi-process contention. The substrate
resolves it by making the trail a **port** (`ports/trail.port.ts`): the shipped `AppendOnlyFileTrail`
satisfies SKP-004 for the MVP's single-writer case with the atomicity boundary enforced in code
(reject rows ≥ 4096 B); a `SqliteWalTrail` (better-sqlite3 or `node:sqlite` once stable) drops in behind
the same interface for the contended/cross-FS case without touching `gate.live.ts`. The gate depends on
the port, never the file.
