# Sprint Plan — Legible Data-Store Topology (datastore-legibility)

> Cycle: datastore-legibility. Implements sdd.md (v1.1, §12-amended) + prd.md (flatline-cured).
> Previous plan archived: sprint.prev-2026-07-03-collections-sot.md.
> Reuses the collections-sot #430 shape (projection · contested fold · fail-loud) verbatim where it fits.
>
> Operator decision (SDD §12): **register the cells first** — the registry doesn't know its members,
> so phase 1 registers the four in-monolith cells before legibility rides on top.
>
> Sequencing (NOT beads blocked-by): S1 → S2 → S3. The settle gate is S1 (ONE cell — ordering —
> legible end-to-end: register → self-report → doctor --data → ratified label → drift). S2/S3 fan out.
> Slice rule: S1 landing alone = "ordering is legible, the pattern is proven" — the report says so if S2/S3 slip.

## Sprint 1: the vertical slice — one cell legible end-to-end (SDD A-1, C-1, C-2, C-3 seed)

### S1-T1 — register the four in-monolith cells as modules [SDD A-1]
Add `shadow-mode`, `shadow-audit`, `apps/worker`, `operator-dash` to `packages/freeside-registry/registry.yaml`
following the `ordering` declaration-keystone precedent (`git_url: …/loa-freeside.git`, `beacon_url: ~`,
`visibility: internal`, `runtime_state` per reality). **AC**: `loadRegistry()` parses all four; a test
asserts the four slugs are present with `visibility: internal`; no existing module entry changes.

### S1-T2 — host_fp derivation helper (shared) [SDD C-2, flatline SKP-001]
`packages/adapters/storage/host-fp.ts`: `hostFp(parts, salt): string` =
`HMAC_SHA256(salt, lower("${engine}://${host}:${port}/${db}"))[:16]` via `node:crypto` `createHmac`;
credentials NEVER in the preimage; default ports elided; parse the connection URL via the existing
`pool-config.ts` source. `CLUSTER_FP_SALT` read via a `configFromEnv`-style helper (fail-closed when unset
in a deployed context). **AC**: same host → same fp; a changed host/db → different fp; a changed
user/password → SAME fp (credentials excluded — test-pinned); missing salt in prod → throws.

### S1-T3 — ordering `GET /admin/data-store` self-report [SDD C-1]
Add the authed route to ordering's Hono app (`intake.ts`), behind its existing `SERVICE_TOKEN` Bearer gate.
Expose `PostgresOrderStore` DB facts: `{ schema_version:'datastore.report.v1', engine:'postgres', host_fp,
reachable (SELECT 1), migrations_applied|null, store:'postgres' }`. The store exposes a `dataStoreFacts()`
method (pool.options → host/port/db → host_fp; never the raw pool). **AC**: authed GET returns the shape;
unauthed → 401; the connection string / password NEVER appears in the body or logs (test asserts absence).

### S1-T4 — `loa doctor --data` reads ONE cell (the settle gate) [SDD C-3]
`packages/freeside-cli/src/verbs/doctor.ts` gains a `--data` mode (`doctorData()` + `DataStoreReport` type),
wired in `bin/freeside-cli.ts:86-98`, reusing the SSRF-safe `hardenedBeaconFetcher` + operator's existing
per-cell credential (NO Railway API). Probes ordering's `/admin/data-store`, prints JSON + a terse table
(follow the `printList` precedent). **AC (settle gate)**: `doctor --data` against a live ordering fixture
shows one row {slug, engine, host_fp, reachable, status}; a cell it can't reach → `unreachable`; exit 0 clean.

## Sprint 2: fan out the self-report + the registry label layer (SDD A-2, A-3, A-4, C-4)

### S2-T1 — absent-store + remaining cell self-reports [SDD A-2, A-3, A-4]
`shadow-audit` + `operator-dash` → absent-store shape (`engine:null, store:'none'`, honest "no datastore").
`shadow-mode` → add `/admin/data-store` to `createShadowRouter` (router-level; full server deferred).
`apps/worker` → add the `/admin/data-store` branch to its raw-http health server behind a shared-secret
`X-Internal-Key` (`timingSafeEqual`). **AC**: each cell returns its correct shape; `store:'none'` renders as
a first-class row (not `unreported`); worker unauthed → 401; a cell without the route → `unreported`.

### S2-T2 — registry `data_store` label layer [SDD C-4]
Extend `ModuleEntry` (`packages/freeside-registry/src/registry.ts:26-54`) with an optional
`data_store: { host_fp, label, purpose }` (the ratified layer — NOT live state). Loader validates it;
absent is legal (unratified). CODEOWNERS-gate the `data_store:` path (operator-owned). **AC**: a module with
a `data_store` label round-trips through `loadRegistry`; a malformed label fails validation loud; live facts
are never stored here (schema forbids reachable/migrations).

## Sprint 3: ratify + drift + full projection (SDD C-3 complete, FR-4/FR-5)

### S3-T1 — `doctor --data` full projection + status classification [FR-2, FR-5]
Aggregate ALL registered cells: join each self-report with its ratified `data_store` label, classify per
SDD §6 precedence (`contested` > `unreachable` > `unreported` > `coherent`; `store:none` its own row).
Terse table + JSON. **AC**: a fixture with one coherent, one unreachable, one unreported, one no-db cell
renders all four correctly; JSON is machine-readable (stable keys).

### S3-T2 — drift = loud [FR-5, reuse #430 drift shape]
A cell whose derived `host_fp` ≠ its ratified `data_store.host_fp` (DB re-pointed) → `contested`, preserves
the operator label, `doctor --data` exits non-zero. Reuse the collections-sot `contested`/fail-loud contract
(`drift.ts:16-135`). **AC**: a fixture where derived host_fp diverges from the ratified label → `contested` +
non-zero exit; a matching host_fp → `coherent` exit 0; the operator label is never overwritten.

### S3-T3 — ratify = git commit (agent proposes, operator ratifies) [FR-4, flatline SKP-003]
`doctor --data --propose` emits a candidate `data_store` label diff (from the derived host_fp) for the
operator to commit — NO runtime write, NO cockpit grant (git ownership is the gate). **AC**: `--propose`
prints a valid registry.yaml diff/patch for an unratified cell; it never writes the file itself; the emitted
label carries the derived host_fp + a blank operator `label`/`purpose` for the operator to fill.

## Goal traceability

| Goal | Met by |
|------|--------|
| G-1 every cell's DB binding legible via one command | S1-T4, S3-T1 |
| G-2 staleness structurally caught (re-derived + drift loud) | S1-T4 (re-derive), S3-T2 (drift) |
| G-3 zero new secrets, no vendor coupling | S1-T4 (reuse cluster auth + hardenedBeaconFetcher; no Railway API) |
| G-4 durable human meaning survives re-derives (git-ratified) | S2-T2 (label layer), S3-T3 (git-commit ratify) |
| G-5 no secret ever leaks | S1-T2 (creds excluded from host_fp), S1-T3 (absence test) |
| (root) registry knows its members | S1-T1 |
