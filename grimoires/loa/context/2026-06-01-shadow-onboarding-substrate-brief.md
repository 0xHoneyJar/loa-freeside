---
title: Shadow-as-Universal-Preview + Medium-Agnostic Onboarding Substrate
date: 2026-06-01
mode: arch
status: candidate
use_label: background_only
provenance:
  source_type: ai-derived
  session: OPERATOR + FREESIDE/GECKO + KEEPER/WEAVER consult; converged in dialogue 2026-06-01
boundaries: >
  Candidate ARCH brief — the converged architecture for the onboarding/shadow workstream.
  Feeds /plan-and-analyze. Not yet a PRD/SDD/sprint. score-api is NOT ours (flag-only).
grounded_against:
  - grimoires/loa/context/2026-06-01-freeside-bot-onboarding-vision.html (operator's 6-step vision mock)
  - grimoires/loa/artifacts/website-review/docs-site/06-shadow-mode.md (shadow doctrine)
  - vault/wiki/concepts/chat-medium-presentation-boundary.md (lens-not-a-class, operator-authored)
  - vault/wiki/concepts/medium-agnostic-acvp-substrate.md
  - freeside-worlds config-service + config-protocol (Effect.Schema, the config seam)
  - freeside-characters persona-engine (Effect .live Layers) + mst-kansei-router (hardcoded MST)
  - bonfire/score-api #221 (Purupuru scoping — NOT ours, flag-only)
  - KEEPER + WEAVER consult (workflow wf_dd546e01-e57)
trust_tier: ai-derived
read_state: skimmed
confidence: 0.6
decay_class: working
last_confirmed: 2026-06-01
operator_signed: self_attested
---

# Shadow-as-Universal-Preview + Medium-Agnostic Onboarding Substrate

## 1. The core reframe (converged with operator)

**Shadow mode is not a feature — it is a universal PREVIEW/DIFF primitive.** For *any*
SaaS feature whose effect you can **consume or mock**, shadow = compute the proposed
effect, render **current → proposed** as a diff, and apply **only** behind an explicit
gate. The user **perceives the difference** before committing.

```
SHADOW = a diff-lens over ANY feature you can consume-or-mock
  current  = consume(live)  ─┐   ← their REALITY today (e.g. Collab.Land role breakdown)
              or  mock        ├─▶ diff ──lens(motion)──▶ before→after  (visualize, don't explain)
  proposed = compute(config) ─┘                              │
                                                             ▼  apply_mode == LIVE  ← the ONE gate
                                                           run the side-effect
```

We are **generalizing a preview we already shipped**: the CV2 WYSIWYG **verify-message
preview** is shadow-for-verify; the **role discrepancy report** is shadow-for-roles;
**announcements** are instance #3. Same primitive.

## 2. The comparison component (the proof-of-value surface)

The diff is rendered as a **purpose-built before/after comparison component**, anchored
in the **context the user already knows**: we consume their **live Collab.Land / Discord
role breakdown** as BEFORE, render Freeside's proposed breakdown as AFTER, and **animate
the transition with motion** so the improvement is *perceived/felt*, not explained.
Show as much in the UI as possible. The same component shadows any feature
(roles, announcements, verify-message) as current→proposed. (FEEL/KANSEI territory:
motion = perceived improvement.)

## 3. The substrate (what worlds-api owns + distributes)

**worlds-api owns the onboarding lifecycle + shadow substrate and DISTRIBUTES it as a
git-source package** (sovereign code distribution, SHA-pinned). Consumers
(freeside-characters = "voiceless" Discord actor, the dashboard, the landing page,
future surfaces) import it. The logic is NOT written inside the bot — the bot executes
upstream logic. (governor/speaker split: worlds-api = pure governor; characters = I/O + voice.)

- **State (per world): `apply_mode : SHADOW | LIVE`** — default SHADOW, the single
  safety-bearing field. The 6 mock steps (Install→Servers→Role-map→Shadow→Go-live) are
  the **lens's view of setup progress**, NOT persistent states.
- **role-map = config** (config-seam input). **discrepancy/diff = read-model** (pure
  projection). Neither is state — that keeps the machine tiny.
- **Pure functions (Effect-typed, no I/O):** `computeProposed`, `diff`,
  `transition(apply_mode, event) → Effect<apply_mode, GuardFailed>`.
- **Ports the actor supplies as Effect `Layer`s:** `RosterSource`, `RoleWriter`,
  score/tier reads. **Mock Layer = shadow/visualize now; Live Layer = real consume+apply
  later.** One mechanism is both the I/O boundary AND the mock-vs-live switch.

### Transitions + guards (worlds-api owns; any lens fires events)
| event | effect | guard |
|---|---|---|
| `install` | record install · `apply_mode=SHADOW` · Manage-Roles granted DORMANT | valid guild · CM authz |
| `bind_map` | write role-map config | valid role-map schema |
| `go_live` | SHADOW → LIVE | **HARD: a discrepancy report exists for the *current* role-map version** · explicit operator act |
| `rollback` | LIVE → SHADOW (instant) | always allowed · Collab.Land untouched |
| `uninstall` | teardown | — |

- **2-week soak = advice, not a lock** (respect the CM's pace; shadow is a legitimate
  forever-home, not just a funnel).
- **Invariant (ACVP-shaped, fail-loud): a Discord role-write is authorized IFF
  `apply_mode == LIVE`.** Everything else is read/compute. Provable: SHADOW ⇒ zero
  side-effects.
- **UX simplicity: one posture per world** (shadow|live). The substrate is
  feature-generic; per-feature gates are a later UX evolution, not a rewrite.

## 4. Medium-agnostic by construction

Entry can come from anywhere — Discord invite, landing page, dashboard, future surfaces.
Each is a **lens** that (a) fires transition events into the worlds-api substrate and
(b) renders state/diffs through the medium. **Cohesion is a consequence, not a
guideline:** one substrate + pure projection ⇒ you cannot break cohesion across media.

## 5. Critical path to a testable Purupuru loop (from KEEPER/WEAVER)

Close the seams raw→presented; don't build new buildings:
1. **score-api#221 (NOT ours — flag + context only):** Purupuru-scoped wallet→score→tier
   (scope/config on the existing world). The deeper intent we own: every cluster has a
   structured schema, fails loud, composes. Draft a context comment for the issue.
2. **Config-seam cutover:** flip `CONFIG_SERVICE_URL` on the role-map dashboard (same
   move as the verify-message cutover #59). For APPLY; shadow-preview can run on mock.
3. **Bot consumes** the role-map surface + a `RosterSource` (`GET /guild-roles`).
4. **The keystone — the shadow/comparison engine** (currently mock in all 5 services):
   `diff(current-roster, proposed)` → the animated before/after. Pure compute in the
   worlds-api package; bot supplies the roster Layer.
5. **Persist `apply_mode`** + bind it to the bot's apply gate (go-live/rollback real).
6. **Second customization (posts/announcements):** new config surface on the same seam +
   un-hardcode the bot router (it drops Purupuru events today).

## 6. Scope note
score-api is **not ours** — flag/provide-context only. We own worlds-api, identity-api,
sonar-api, freeside-characters, the dashboard. The shadow substrate + comparison
component + the medium-agnostic onboarding state machine are the build.
