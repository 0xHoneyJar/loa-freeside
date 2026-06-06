---
title: "Session 3 — Freeside CM Control Plane: theme→role map + the runway"
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
confidence: 0.50
decay_class: working
last_confirmed: 2026-05-31
---

# Session 3 — Freeside CM Control Plane: theme→role map + the runway

> The authoring loop is live end-to-end. This session closes the theme→role map (the bot half), then the account profile, then the runway.

## Context

The freeside-dashboard is the **community-manager control plane** for the Freeside cluster. As of 2026-05-31 the full **authoring loop is live**: a CM wallet-signs in → lands on their worlds → edits a world's verify message in a WYSIWYG composer → saves to the deployed config service → (the bot will) render it. What shipped to `main` this session:

- **config service** LIVE (`config-service-production-5501.up.railway.app`) — surfaces `verify-message` + `role-map`; read-gate `x-service-token`, write-gate `Authorization: Bearer <CM JWT>`.
- **CV2 verify composer** (#53) — medium-parametric WYSIWYG preview via `@0xhoneyjar/discord-renderer` (git-source, away-from-npm). The preview is THE medium-presentation lens (Discord wired; CLI/Telegram are register slots).
- **wallet-sign CM login + account display** (#54) — server-mediated SIWE → first-party HttpOnly `fc_session`; account menu shows wallet address + per-world nyms; live-QA'd + BB-hardened (8 findings).
- **project-switcher → managed-worlds** (#55) — demo-safe fallback pre-grant.
- **role-map surface** (worlds-api #6) — **Reference model**: score-api owns the tier ladder + thresholds; the role-map only BINDS each score-api tier-id → a Discord role + restyles (label/color). `TierRung = {id, label, color, discordRoleId?}`. **Surface is live** (`GET /v1/config/:world/role-map` → 404 `not_configured`, not `unknown_surface`).

The CONTRACT is set; what remains is the bot half + the editor + the profile.

## Run via — `code-implement-and-review` + `ground-and-craft`

The session's proven loop (use `/compose` to resolve the yaml):
- **P2, P4 (bot code)** → `code-implement-and-review`: scaffold-agent → **BB-review (BEAUVOIR)** → remediate → PR. (Auth-grade caution on anything touching the Discord token / role grants.)
- **P3 (editor UI)** → `ground-and-craft`: **ARTISAN (ALEXANDER)** writes the token-level spec from the existing Sprawl art → build-agent executes → BB-review. The composer (CV2 preview) is the craft precedent.
- **Operator directs at the seams**: AskUserQuestion forks (one rich question, lead with the doubt) + the live QA walkthrough (the operator runs the loop in their browser; you stage the env + seed grants via `CM_WORLD_ALLOWLIST`).

## Load Order (read first)

1. `grimoires/loa/context/2026-05-31-cluster-topology-map.md` — the cluster mental model (8 buildings, belts, 3 seams).
2. `grimoires/loa/context/2026-05-31-ride-ground-truth.md` — the active grounding.
3. worlds-api `packages/config-protocol/surface-config.ts` — the `role-map` + `verify-message` surface schemas (the contract you write against).
4. freeside-dashboard `src/lib/freeside-worlds/{config-client.ts,cm-session.ts,cm-auth.ts,surface-config.ts,validate.ts}` — the write client + CM-auth gate + the vendored config-protocol mirror.
5. freeside-dashboard `src/app/(freeside)/[project]/compose/` + `src/components/freeside/composer/` — the verify composer (the pattern P3 follows 1:1).
6. freeside-dashboard `src/app/(freeside)/_data/roles-shared.ts` — the hardcoded `TIER_LADDERS` (`TierDef = {id,label,gate,color}`) the role-map seeds its defaults from.
7. freeside-characters `apps/bot/src/world-config.ts` — `fetchVerifyMessageConfig` (the config-read pattern P2/P4 mirror) + the guild→world resolution.
8. The memory index (`~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/memory/MEMORY.md`) — esp. [[config-service-deployed]], [[module-self-distribution-doctrine]], [[sovereign-code-distribution]], [[deployed-but-unconsumed-pattern]].

## What to Build (dependency-ordered)

### Track 2 — the full theme→role map

**P2 — bot role-awareness endpoint** (`freeside-characters`) · *independent, fire first*
A bot HTTP endpoint that returns a guild's Discord roles (`{id, name, color}`) so the dashboard's editor can offer them. The bot already runs an interaction/HTTP server (`startInteractionServer`) + has the Discord token + guild access. Net-new, mirrors the (future) emoji-sync shape (`arrakis-fh5r`). Auth: a service-token (the dashboard calls it server-side, no browser CORS — same posture as the config service). Resolve guild from the world_slug (the seeded `SEEDED_GUILD_WORLD_MAP` in `world-config.ts`).

**P3 — dashboard role-map editor** (`freeside-dashboard`) · *needs P1 (live) + P2*
A new surface in the composer pattern. Reads: (a) score-api's tier ids for the world (the `TIER_LADDERS` / the live tier set — score-api OWNS the ladder), (b) P2's live Discord role list. For each score-api tier, the CM binds a Discord role (picker from P2) + overrides label/color (seeded from the score-api default). Writes via `config-client.putSurfaceConfig('role-map', ...)` (the surface is live) behind the CM-auth gate (`authorizeCmForWorld`). Add the `role-map` mirror to the dashboard's vendored `surface-config.ts` + `validate.ts` (faithful to the canonical config-protocol — never get ahead of it or saves 422). **ARTISAN spec the editor UI** against the Sprawl tokens.

**P4 — bot role-assignment** (`freeside-characters`) · *needs P3 producing configs*
The bot reads the `role-map` config (`GET /v1/config/:world/role-map`, `x-service-token`) + each member's **score-api-computed tier** → assigns the bound `discordRoleId`. score-api owns tiering (the roster's live tier counts); the gate is NOT in the role-map. Unbound rung (no `discordRoleId`) → skip. This CLOSES the theme→role loop. Auth-grade: it grants real Discord roles — BB-review hard.

### Then — the account profile page (`arrakis-7nw9`)

A per-USER Settings/Profile surface (distinct axis from per-WORLD config): the **global Freeside username** (NEW — identity-api has only per-world `world_identities` today; the global handle does not exist yet → net-new identity-api field/endpoint) + **pfp** (freeside-storage) + **credits** (billing/ledger). The account-menu already has the `globalUsername` seam (`accountPrimaryLabel` precedence: global-username → wallet → user_id). **Show per-world nyms for clarity; never adopt a world's nym as the Freeside username.** This is the "configuration & settings profile" — the one route the gap-map flagged as having no surface yet.

### Runway (beaded, sequence after the above)

- **`arrakis-83y2` (DB-4)** — bot POSTS the config-driven verify card. `buildVerifyCardForGuild` has **no live caller** (only the preview gallery renders `buildVerifyCard`); the card is hand-posted today. Build a publish path (bot admin command OR dashboard "publish to channel" → bot endpoint) so the CM's saved verify message actually appears. This is the READ half of the original loop.
- **`arrakis-et2h`** — composer expressiveness: drag-in CV2 blocks + nesting + Shadcn/collapsibles (the recursion-shaped dispatcher already supports it; extend the palette — needs Section/Thumbnail builders ADDED to mediums per the C-5 narrowness).
- **`arrakis-tkma`** — logo/image upload via freeside-storage (CMs drop images → storage → usable in CV2 Thumbnail/Gallery).
- **`arrakis-fh5r`** — Discord custom-emoji sync (same bot-role-awareness shape as P2, for emojis).
- **`arrakis-ea3i`** — roster Discord-reachability via identity-api VERIFIED links: needs a batch `wallet[] → linked_accounts` endpoint (identity-api net-new) + replace `mock-discord.ts`. SoR DECIDED: identity-api verified links (not score-api/MIDI's unverified handle).
- **`arrakis-ank6`** — Discord-OAuth login (after wallet-sign): net-new identity-api surface (OAuth callback, account→user, session mint) — lowers the wallet-sign suspicion bar for non-crypto CMs. Strategy: the Discord bot is the distribution entry point.
- **`arrakis-3vge`** — (if not yet merged) the Next-16 `defaultVerifyConfig` build break fix (#52 merged — verify clear).
- **`arrakis-euqr`** — mediums self-distribution (ship dist + CI) → drop the dashboard's postinstall fixup.

## Design Rules

- **Reference model is law**: score-api owns the tier ladder + gates. The role-map BINDS + restyles its tier-ids; never define a tier or a gate in the role-map (the schema rejects a `gate` key).
- **Schema changes mirror `verify-message`** exactly: closed schema (`onExcessProperty: 'error'`), bounded strings + control-byte/zero-width reject, the discriminated-union envelope. Land in config-protocol FIRST (auto-redeploys the live config service), then the dashboard mirror.
- **Away-from-npm**: consume cluster libraries via git-source (`github:0xHoneyJar/<repo>#<sha>` + the pnpm/bun postinstall fixup); `mediums-api` is public. Never `npm install @0xhoneyjar/...`.
- **Server-mediated, no browser CORS**: identity-api + the bot have no CORS for the dashboard origin — the dashboard calls them from its OWN Next route handlers (server-side), token never in the browser.
- **ARTISAN for UI**: structure → material → Ma → motion; every value is a token (oklch/px/spring), honest-contrast (Sprawl frame holds the medium surface), the 90/10.
- **Per-USER profile ≠ per-WORLD config**: the profile (username/pfp/credits) is a different axis from the config surfaces (verify-message/role-map). Don't conflate.

## What NOT to Build

- NO `gate` in the role-map (score-api owns it). NO tier *definitions* in the dashboard (reference score-api's ids).
- NO re-hand-rolling the CV2 grammar (consume `discord-renderer`; don't repeat the bot's `enriched-render.ts` drift).
- NO adopting a per-world nym as the global Freeside username.
- NO new repos / prefixes (factory model: one building = one repo; the dashboard is a surface).
- NO browser-direct calls to identity-api/score-api/bot (server-mediated only).

## Verify

- **worlds-api** (config-protocol): `bun test packages/config-engine` + `bun install --frozen-lockfile`; merge → config service auto-redeploys (probe `GET /v1/config/mibera/<surface>` flips from `unknown_surface` → `not_configured`).
- **freeside-dashboard**: `pnpm build` (next build, exit 0 — Vercel needs the public mediums-api fetch) + `bun test tests/unit/`; the repo ships pre-existing RED on CodeQL/Dep-Review/Template — ignore.
- **freeside-characters** (bot): the repo's test/build; Railway GH-integration auto-deploys from main (`railway run` to verify prod).
- **End-to-end QA** (the proven pattern): stage a dev server on the feature branch with `.env.local` (IDENTITY_API_URL, APP_URL, CONFIG_SERVICE_URL + token, CM_WORLD_ALLOWLIST=mibera,purupuru, score-api + DATABASE_URL pulled from prod Vercel via `vercel env pull`), the operator wallet-signs + walks the loop live.

## Key References

| Topic | Path |
|---|---|
| Cluster mental model | `grimoires/loa/context/2026-05-31-cluster-topology-map.md` |
| role-map schema (the contract) | worlds-api `packages/config-protocol/surface-config.ts` |
| config write client + CM-auth | freeside-dashboard `src/lib/freeside-worlds/{config-client,cm-session,cm-auth,cm-verify}.ts` |
| composer pattern (P3 mirrors) | freeside-dashboard `src/app/(freeside)/[project]/compose/` + `_data/composer.ts` |
| account-menu + global-username seam | freeside-dashboard `src/components/auth/account-menu.tsx` + `account-display.ts` |
| bot config-read pattern (P2/P4) | freeside-characters `apps/bot/src/world-config.ts` |
| hardcoded tier ladders (role-map seed) | freeside-dashboard `src/app/(freeside)/_data/roles-shared.ts` |
| config service deploy facts | memory [[config-service-deployed]] |
| beads | `br list --status open` filter `cycle:freeside-dashboard` (arrakis-7nw9, 83y2, et2h, tkma, fh5r, ea3i, ank6, euqr) |
