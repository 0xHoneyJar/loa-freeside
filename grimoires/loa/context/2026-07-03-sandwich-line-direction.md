---
status: candidate
created: 2026-07-03
author: microlight-swarm-3 (5 probes: shadow, worlds, dnft, EULER, KEEPER) + /recall (priority order shadow-mode > shadow-audits > freeside > dNFTs)
mode: arch
plannable: true
source_construct_affinity: [shadow-audit, shadow-mode, ordering-service, freeside-worlds, freeside-storage, euler, keeper]
---

# Next-cycle direction — The Sandwich Line: deploy the audit, persist the worlds, serve the demo

## The thesis (one sentence)

Deploying shadow-audit-api is the EULER-verified cut vertex that lights four dormant consumers at
once (the dashboard's audit client, the shadow_preview probe leg, the CM wedge, and shadow-mode's
first consumer path) — and alongside it the cycle must fix a LIVE data-loss bug (fulfilled orders'
world manifests evaporate on redeploy) and fulfill the rehearsal order, because KEEPER's sweep
shows the demo is the gate on any external customer ever existing.

## Probe findings (all verified 2026-07-03, file:line in probe reports)

### EULER (graph verdict)
- **Cut vertex CONFIRMED, refined**: not "the deploy" as a monolith but B′ (COLLECTION_REGISTRY +
  RPC_URL_<chain> + OPERATED_COMMUNITIES config, operator-verified values) + B (the built HTTP
  surface: PR #387's server.ts/bin/http.ts/Dockerfile/railway.toml, 100% dormant). Highest
  betweenness by a wide margin; removing it disconnects the sandwich AND the probe leg entirely.
- **Counter-hypothesis FALSIFIED**: the audit does NOT need the shadow-mode ledger first — zero
  imports of @freeside/shadow-mode-* anywhere; ownership comes from sonar Transfer-replay.
  Ledger-consumption is DOWNSTREAM of the audit deploy.
- **Critical**: the deployed ordering-service wires `NoopAudit` + empty communities registry
  (composition.ts) — "ordering is LIVE" but structurally cannot serve an audit in-process.
- **Weakest edge on EVERY goal path**: sonar #120 (chain-1 Azuki, 0 holders) — blocks both the
  fulfillment demo and an Azuki audit.
- **Parallel-spine HAZARD**: shadow-audit ships its OWN ownership projection machinery
  (projection-ownership-source.ts, built+tested, UNWIRED — bin/http.ts wires sonar replay instead)
  while shadow-mode's ledger folds the same NATS stream into an independent L2 read-model. Two
  divergeable ownership truths. **DECIDE the spine before any ledger-consumption work.** (Also:
  open FAGAN HIGH-3 on value semantics per token standard — contract test before any cutover.)

### ml2-shadow (deploy blockers, exact)
- Every required env THROWS at boot (fail-loud verified): COLLECTION_REGISTRY (strict zod:
  `"<chain>/<contract>" → {collection, standard: erc721|erc1155}`), RPC_URL per registry chain
  (boot sweep), OPERATED_COMMUNITIES (nonempty), CTA_PRODUCT/CONVERSATION. AUDIT_K=0 rejected.
  API key optional (unset ⇒ open k-anon aggregate, logged). DATABASE_URL NOT needed (in-memory
  event store; sql/0001 is an unwired seam).
- **THE one silent-wrong**: a typo'd collection id → empty, silently-wrong audit. Only
  `pnpm -C packages/adapters test:live` catches it. **Deploy is blocked on the OPERATOR producing
  real (chainId, contract)→collection pairs** — collection ids+chains copyable from shadow-audit
  DEPLOY.md ("Live-grounded auditable set": 8 collections; chains broader than memory —
  HoneyJar3→zora 7777777, HoneyJar4→op 10, each gen canonical chain + Bera bridge); contract
  ADDRESSES are not in-repo.
- Shadow-MODE ledger: in-memory only (no PostgresLedgerStore), **ZERO consumers** since #316.
- **Smallest honest probe read** (for the ordering seam): NOT a runs-read (RunEvent is .strict()
  with no chain/contract — widening is a privacy decision). Instead:
  `GET /v1/collections/:chain/:contract` → 200/404 registry-membership read ("is this contract
  auditable here") — satisfiable by ordering's (chain,contract) probes, maps onto existing
  mapLookupStatus, no auth, no schema widening. Closes bead arrakis-r3kr.

### ml2-worlds (the data-loss bug + the fulfilled→living gap)
- **LIVE DATA-LOSS BUG**: worlds-api PR #13 (merged 07-01) writes manifest yaml + index to the
  config-service's EPHEMERAL Railway container FS (railway.toml has no volume). The "azuki"
  lookup entry + every fulfilled order's manifest EVAPORATE on next redeploy. The service already
  has a durable Postgres ConfigStore path to reuse.
- Fulfilled today durably produces: ONE GitHub issue card (freeside-worlds#14). No yaml in git, no
  world-azuki.tf, no ECS task, no repo, no rendered surface (dashboard /worlds/azuki → 307 login).
- Worlds deployment registry (freeside-worlds/packages/registry/worlds/*.yaml → generate-tf →
  terraform → ECS) is REAL for apdao/mibera/midi/rektdrop. Zone schemas unpublished (#3 HIGH).

### KEEPER (demand truth — the honest negative)
- **No external customer exists.** Both deployed orders are operator rehearsals
  (kitchen-smoke@internal.demo, kitchen-e2e@freeside.test). "Azuki" is the test subject, not
  Azuki asking.
- **Pythenians = the one code-declared outreach partner** (OUTREACH_CATALOG_SLUGS=["pythenians"]);
  the dashboard's entire 2-week commit stream is member-intelligence surface for them. Counter-
  signal: the inventory outage produced zero complaints → consumption is operator-demo, not
  member-organic yet.
- notzerker's sonar scoring asks (#115/#95/#74) = healthiest organic demand; cheap goodwill.
- **Access-audit wedge: ZERO external signal.** It's a theory the operator holds; the cycle serves
  the demo, it must not overclaim market.
- Settle checks: next order's contact field non-test = real demand; Vercel analytics non-team
  sessions on pythenians pages.

### ml2-dnft (priority 4)
- The 3-layer manifest pattern is LIVE + verified E2E for Mibera (tokenURI →
  metadata.0xhoneyjar.xyz/{collection}/{id} → CF Function + KV pointer → S3; grail override
  works). But it's KRANZ-tribal (untracked DNS, manual flips), `freeside-storage` is a STUB, NO
  per-world namespace (only /mibera/ resolves), and the metadata substrate has no registry cell
  (loa doctor is blind to it). Active "dNFT" energy moved to loa-finn (per-NFT agents) which
  CONSUMES this substrate.

## Scope shape (candidate FRs, priority-ordered per operator: shadow mode > audits > freeside > dNFTs)

- **FR-1 (audits→mode, the cut vertex):** deploy shadow-audit-api to Railway as a new cell —
  operator supplies COLLECTION_REGISTRY addresses ([OPERATOR-BOUNDED], the silent-wrong gate) +
  runs `test:live`; registry cell + beacon note added. Consumes 100% of PR #387.
- **FR-2 (ordering seam):** `GET /v1/collections/:chain/:contract` capability read on the audit +
  real `probeShadow` + retire `SHADOW_PREVIEW_UNAVAILABLE_POLICY` (closes arrakis-r3kr). Depends FR-1.
- **FR-3 (the sandwich):** dashboard env-point (SHADOW_AUDIT_API_URL+_KEY, zero code) → run ONE
  real internal-look audit report (oracle C4) and land it (C5). The demo artifact.
- **FR-4 (worlds keystone):** fix the manifest persistence hole — back FileManifestStore with the
  existing durable Postgres ConfigStore path (small, single service). The data-loss bug dies.
- **FR-5 (demo gate, carried lane):** sonar #120 spike (weakest edge on every path) + fulfill the
  rehearsal order via `fulfill watch`. KEEPER: the demo gates all external demand.
- **FR-6 (shadow-MODE, decision-first):** D-1 spine decision — audit's own ownership projection
  vs shadow-mode ledger as THE L2 ownership read-model (EULER hazard). Ledger CONSTRUCTION is
  explicitly out until decided + a consumer demands it (zero consumers since #316; FAGAN HIGH-3
  contract test is a precondition of any cutover).
- **FR-7 (dNFT rider, cheap):** registry cell for the live metadata substrate
  (metadata.0xhoneyjar.xyz) + fix the dead storage beacon pointer — discovery stops being blind.
  The per-world resolver codification (freeside-storage stub → installable) is a NAMED FOLLOW-UP,
  trigger: first world needing dynamic metadata.

## Non-goals (defer with triggers)
- Full fulfilled→provisioning pipeline (generate-tf → terraform → world repo) — own cycle;
  precondition: operator decision on auto-created repos + secrets handling.
- PostgresLedgerStore / NATS consumer for shadow-mode — until FR-6's decision + a real consumer.
- Per-world metadata namespace build-out (freeside-storage) — trigger above.
- loa-finn dNFT engine — different repo/team; we only keep its substrate consumable.
- Thin /worlds/{slug} public surface — candidate rider if the cycle runs light (KEEPER: demoable).

## Collision fences
- loa-cli: operator mid-flight on fix/census-live-registries (dirty tree) — do not touch.
- sonar-api/kitchen-api: #120 spike is read+diagnose; fixes via /coord PR, never admin-merge.
- freeside-worlds: FR-4 in config-service package; PR #10 (pythenians shadow world, DRAFT) is
  someone's open work — don't rebase/modify it.

## User-truth hypotheses (settle against behavior)
- If FR-1..3 land, ONE real internal audit report exists on main (C4/C5 flip green) and the
  dashboard renders it — the wedge becomes demoable instead of theoretical.
- If FR-4 lands, a fulfilled order's manifest survives a config-service redeploy (kill-test:
  redeploy, re-lookup azuki → 200).
- If FR-5 lands, order 65e94061 (or its pivot) reaches `fulfilled` and KEEPER's settle-check arms:
  watch the NEXT order's contact field for a non-test address.
