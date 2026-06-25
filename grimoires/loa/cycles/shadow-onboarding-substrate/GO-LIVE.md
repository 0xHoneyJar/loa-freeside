# shadow-onboarding-substrate — GO-LIVE runbook

> **Single resumption index.** The cycle's *code* is complete and merged. Everything
> left is **operator data + deploy** (not code), gated on preconditions only you have.
> This file is the map: status → what's proven → the ordered go-live → how to verify →
> the loose follow-up threads. Written at cycle close 2026-06-02 for the next Loa.

---

## Status: CODE COMPLETE + MERGED

The substrate is a **universal preview/diff primitive** (current→proposed; apply only
behind a substrate-enforced gate). `@freeside-worlds/shadow-substrate` is the pure
Effect governor; the dashboard + characters are **voiceless I/O lenses**.

| Repo | Sprint | State | SHA | Review |
|------|--------|-------|-----|--------|
| `freeside-worlds` (substrate S0/S1/S2) | 401–403 | pushed on `cycle/shadow-onboarding-substrate` | `26d11b78` (substrate) · `da97e0c` (HEAD, +purupuru.yaml) | FAGAN-converged |
| `freeside-dashboard` (S3 web lens) | 404 | **MERGED → main** | PR #64 → `ed06f956` | FAGAN + BB=COMMENT clean |
| `freeside-characters` (S4 live Discord Layers) | 405 | **MERGED → main** | PR #161 → `54061ca` (fix `a1ef744`) | FAGAN + BB REQUEST_CHANGES → driven+fixed |

The cross-repo version contract is `substrate-sha.lock` (this dir): canonical substrate
SHA `26d11b78`, events pin `68f5a89`, frozen conformance hash `eda5e02d`. Every consumer
CI asserts its pin == canonical and runs `conformance/check.ts`.

## What's PROVEN (the gate guarantee)

The headline invariant — **"SHADOW ⇒ zero writes" survives the repo boundary** — is proven,
not asserted:
- The substrate's `GateCheckedRoleWriter` reads `apply_mode` at invocation time under a
  batch-duration mode-lock; under SHADOW it rejects → `shadow.role.rejected.v1`; writes
  only after audit. §8.4 fast-check property test proves zero writes under SHADOW.
- FR-10 authz floor: real `jose` JWKS verify (ES256/RS256 allowlist, `exp` required,
  https-only-in-prod, fail-closed) → `resolveAuthz` membership against `admin_principals`.
  **Empty allowlist = deny-all.**
- Cross-repo import-boundary lint: a raw `discord.js` role mutation anywhere outside the
  single gated adapter (`apps/bot/src/shadow/role-writer.live.ts`) **fails CI**.
- BB fix (characters #161): exactly one `@0xhoneyjar/events` build in-process (no ACVP
  canonicalizer skew) · roster read **once per batch** under `WorldLock` (no 429
  amplification) · GC **fails closed** on partial member-hydration (never strips users).

---

## TO GO LIVE — operator, in order (data + deploy, NOT code)

This is bead **`arrakis-s4-e2e-goal-validation-g0z2`** (405.E2E) — the live Purupuru loop.
It is what "S5" would have been; there is **no code S5**.

### 1. Fill `purupuru.yaml` — the operator preconditions
`freeside-worlds/packages/registry/worlds/purupuru.yaml`, block `shadow_onboarding:`.
The manifest documents each field; the four `TODO(operator)` placeholders:
- **`guild_id`** — canonical Purupuru Discord guild snowflake (17–20 digits). The live
  RosterSource/RoleWriter resolve roles+members against it. Uncomment + set.
- **`admin_principals`** — the FR-10 allowlist: identity-api `user_id` (`claims.sub`) of
  each CM authorized to bind the role-map + `go_live`. **Empty = deny-all (fail-safe).**
  Lives in the manifest, never a config surface (SKP-007 — the write path can't self-grant).
- **`nft_contracts`** — qualifying contract address(es); feeds the (MOCKED for MVP)
  latent-member surface (real qualification is Phase-2; score-api is not ours, #164/#221).
- **`member_set`** — holder/member set for shadow-PREVIEW on mocked data.

`namespace_prefix: "purupuru:"` is already set (the FR-9 coexistence boundary — Freeside
touches only roles starting with this prefix; Collab.Land roles are never contended).

### 2. Deploy the config-service + wire live secrets
- Deploy a config-service reachable at **`CONFIG_SERVICE_URL`**.
- Wire **live JWKS** (the config-service token-verify endpoint), the **Discord bot token**,
  and the **NATS signing key** (the ACVP audit emitter).
- See the cluster's config-service deploy notes (memory: *Config service deployed (C-6)* —
  `config-service-production-…railway.app`, read-gate `x-service-token`).

### 3. Run the live E2E (G-1…G-6) and confirm SHADOW before LIVE
- With the world in **SHADOW** (default), run the live loop: render the before/after in
  the dashboard + the CV2 message in Discord, against the live guild roster.
- Confirm **zero role mutations** occur (the gate guarantee, now on live infra).
- Flip `apply_mode` SHADOW→LIVE **only** after: roster-hash match + fresh authz re-check +
  the soft soak. `go_live` mints the `WriteCapability`; the first live write is audited.

---

## VERIFY (before trusting live)

```bash
# characters (apps/bot): the cross-repo pin + single events build + frozen shapes
cd freeside-characters/apps/bot && bun run conformance:check          # → all assertions passed
cd freeside-characters/apps/bot && bun run lint:shadow-import-boundary # → no mutation outside gated adapter
# the substrate gate property test (SHADOW ⇒ zero writes) lives in the substrate package §8.4
```

## Loose follow-up threads (tracked, non-blocking)

| Thread | Bead / where | Note |
|--------|--------------|------|
| Register `shadow.*` ACVP families | `arrakis-s1-register-acvp-families-t8qy` (402.7) | **The one remaining codeable scrap** — in loa-freeside's events package. Small. |
| Cross-batch id-binding governor | `arrakis-s4-followup-assign-roleid-drj2` | Thread `role_id` into `AssignRoleIntent` so a *later* batch binds by id, not name. Deferred; the namespace guard bounds the risk meanwhile. |
| Substrate → worlds `master` | — | worlds default branch is **`master`**. The substrate lives on the cycle branch; consumers pin `26d11b78` (reachable only via it). **Do NOT delete `cycle/shadow-onboarding-substrate` in worlds.** Landing it on `master` is the clean follow-up (no PR opened — operator's call). |
| Vercel build cred | — | The dashboard Vercel build needs a repo-scoped `GITHUB_TOKEN` to fetch the private substrate tarball (build-env secret, not in the PR). |
| Conformance → dashboard CI | dashboard BB #64 medium | `conformance:check` is built but not fired in the dashboard CI — the safety net exists but isn't wired. Wire it. |
| Hygiene smell (not ours to fix here) | — | `freeside-dashboard` main carries `grimoires/pub/research/eileen-gtm-feedback-verbatim-*.md` — **licensed/vault content committed to a repo**. Its Template-Protection check reds on every PR because of it. Worth a scrub. |

> Note on the dashboard's red CI checks: Dependency Review + CodeQL fail only because
> **GitHub Advanced Security is not enabled** on the repo (CodeQL scanned clean, failed at
> upload). Template Protection reds on the licensed content above. None are caused by the
> cycle's diff — the substantive checks (Vercel, secrets, NPM audit) are green.
