# Product Requirements Document — Aleph Host Portability (ProviderPort + SandboxPort)

> Cycle: **aleph-host-portability**. Theme: implement loa-aleph Decision 0005 —
> extract the two host pins (provider literal, sandbox mechanism) into
> profile-sanctioned ports so Aleph runs attested on macOS with headless Claude
> auth, without weakening any capability floor. Cross-repo: planning lives here;
> implementation lands on a loa-aleph branch stacked on PR #37.
> Previous cycle archived: `grimoires/loa/archive/cycle-51/` (cadence-ledger).

## 1. Problem Statement

The loa-aleph runner contract commits to host neutrality — "a runner is a
replaceable host mechanism"; "the Fable profile is one first reference runner,
not the runner contract" (`adapter-protocol/runner-capability-contract.md`) —
and its capability contract states "runtime … details belong to adapter
profiles" (`adapter-protocol/capability-contract.md`). The structurally
implemented Loa adapter contradicts this in code:

- `--provider` accepts only the literal `amazon-bedrock`
  ([CODE:adapters/loa/src/host-attestation.ts] parse guard; type literal +
  three enforcement sites in [CODE:adapters/loa/src/claude-code-host.ts]
  incl. `BEDROCK_CREDENTIAL_ENVIRONMENT`).
- Isolation is bubblewrap-only with Linux-FHS mounts
  ([CODE:adapters/loa/src/claude-code-host.ts] `resolveBubblewrapExecutable`,
  `REQUIRED_READ_ONLY_MOUNTS` incl. `/lib64`) — darwin cannot reach preflight
  at any lifecycle tier.

Consequence: the two operators closest to Aleph run disjoint hosts
(Linux+Bedrock vs macOS+subscription CLI). The macOS host executed the first
real downstream Précis lifecycle (loa-freeside `cr-contract-corpus`,
2026-07-19, manual mode) — the method works there; the attested runner is
structurally excluded. Decision 0005 (loa-aleph PR #37, Status: Proposed)
proposes the port extraction; this cycle implements it as evidence.

> Sources: Decision 0005 (`docs/decisions/0005-host-portability-provider-and-sandbox-ports.md`, PR #37); loa-aleph AGENTS.md status table ("not validated or sanctioned"); session grill rulings 2026-07-19.

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Darwin host attestation | `host-attestation.ts attest --provider claude-cli-subscription --sandbox seatbelt` exits 0 on the operator's Mac and emits a valid receipt (digest, probes with `observed_model`, port identities) |
| G-2 | Sealed worker round-trip on darwin | One `prepare → dispatch → accept` cycle against a fixture worker bundle succeeds under Seatbelt with valid `native-return.json` + evidence digests |
| G-3 | Bedrock byte-parity | Existing bedrock+bubblewrap path produces byte-identical receipts/evidence; proven by her existing test suite + parity fixtures |
| G-4 | Her suite green on darwin | Full `npm test` passes on macOS — requires fixing loa-aleph#36 (`/private/var` realpath in `test:loa-host`) as the first task |

DONE = G-1 ∧ G-2 ∧ G-3 ∧ G-4 (operator ruling, Phase 2 Q2: "Attest + round-trip").
Explicitly NOT a goal: lifecycle advancement — everything ships `planned`/
`implemented`; `validated`/`sanctioned` remain Eileen's authority acts.

> Sources: Phase 2 Q2 discovery ruling (2026-07-19); capability-contract.md lifecycle tiers; loa-aleph#36.

## 3. Users & Stakeholders

- **operator:eileen** — sole loa-aleph authority (CODEOWNERS `@eileen1337`).
  Consumes this work as a stacked draft PR = evidence for Decision 0005. Merge
  and every lifecycle advancement are hers. Runs Linux+Bedrock (reference pair
  must stay byte-stable).
- **operator:zksoju** — macOS + Claude subscription (no Bedrock). Needs the
  attested runner locally; volunteers as replay-evidence source for the
  seatbelt+subscription pair.
- **Downstream Loa repos** — receive the updated adapter automatically via
  loa's `aleph-release-sync` bundle ingestion after (and only after) Eileen
  releases; no loa-side PR exists in this cycle.

> Sources: loa-aleph `.github/CODEOWNERS`; loa `.github/workflows/{aleph-release-sync,aleph-bundle-integrity}.yml` (verified via gh 2026-07-19); Phase 3 session rulings.

## 4. Functional Requirements

### FR-1 ProviderPort seam
Extract a `ProviderPort` interface (id, required credential environment,
attestation probe args, fallback-disabling controls) from the current inline
bedrock logic. Two implementations in v1 (Phase 4 Q3 ruling):

- `amazon-bedrock` — reference; behavior and receipts byte-identical (G-3).
- `claude-cli-subscription` — macOS Keychain OAuth ("Claude Code-credentials"
  generic password; verified present, CLI 2.1.215). Credential presence check
  = Keychain probe, not env vars.
- `anthropic-api` — DECLARED in the registry as `planned`, unimplemented
  (registry entry + error message only).

### FR-2 Exact identity under alias (probe-observed pin)
Subscription port satisfies `exact_model_identity` by pinning the
**probe-observed** model id (`observed_model` from stream-json evidence) into
the receipt; every subsequent dispatch re-verifies observed == pinned and
fails closed on drift (mid-run model updates kill the run). (Phase 4 Q3 grill
ruling; floor: "a host alias or silent fallback does not qualify".)

### FR-3 SandboxPort seam
Extract a `SandboxPort` interface (id, platforms, executable resolution +
digest, policy generation + policy-digest material). Two implementations:

- `bubblewrap` — reference (Linux); `REQUIRED_READ_ONLY_MOUNTS` moves into
  this port's policy; byte-identical behavior (G-3).
- `seatbelt` — darwin `sandbox-exec` with a generated deny-default profile:
  worker bundle read-only, writes only to return root, explicit allows for
  `/dev/null` / tty devices and required mach-lookups (Keychain/securityd
  for the subscription port). `policy_digest` = SHA-256 of the generated
  profile text. Port declaration DOCUMENTS the weaker-than-namespaces
  guarantee (policy confinement, no PID/net namespace) — honest classing for
  Eileen's validation judgment (Phase 4 Q2 grill ruling).

**Probe facts (2026-07-19, macOS 26.3, this machine)**: `sandbox-exec`
enforces — subpath deny blocked writes; deny-all + allow-return-root held
(`GLOBAL-WRITE-BLOCKED`, `RETURN-ROOT-WRITE-OK`); headless `claude -p`
completed successfully INSIDE a write-restricted profile with Keychain auth
(`PORT-PROBE-OK`). `/dev/null` requires an explicit allow (captured for the
profile generator).

### FR-4 Profiles own sanction
Profile schema gains `runtime_requirements.sanctioned_ports.{providers,sandboxes}`.
`loa-default` pins `["amazon-bedrock"]` + `["bubblewrap"]` (unchanged
behavior). New `loa-macos-headless` profile pins
`["claude-cli-subscription"]` + `["seatbelt"]`. Attesting through an
unsanctioned port fails preflight exactly as an absent capability does.

### FR-5 Receipt port identity + back-compat
Receipts/evidence gain `runtime.provider_port` and `runtime.sandbox.port`.
Existing bedrock receipts remain valid under defaulting
(`amazon-bedrock`/`bubblewrap`). No other schema shape changes (evidence is
already digest-based and mechanism-neutral).

### FR-6 Token-denominated budget (subscription)
Subscription port declares budget in TOKENS with receipt field
`budget_unit: "tokens"` (bedrock keeps `"usd"`), enforced fail-closed from
stream-json usage fields. Budget exhaustion blocks, never silently truncates.
(Phase 5 Q4 ruling — rejected estimated-USD as identifier-shaped-not-real.)

### FR-7 Darwin test fix (prerequisite)
Fix loa-aleph#36: `test:loa-host` fixture compares unresolved vs
realpath-resolved temp paths (`/var` → `/private/var` symlink). Normalize via
realpath at fixture setup. First task — G-4 gate cannot run without it.

> Sources: Decision 0005 §Decision [PR #37]; grill rulings Q1–Q4 + discovery rulings Q3–Q4 (2026-07-19); live probes §FR-3 (this machine); [CODE:adapters/loa/src/claude-code-host.ts]; [CODE:adapters/loa/src/host-attestation.ts]; loa-aleph#36 (reproduced on clean main 5472292).

## 5. Non-Functional Requirements

- **NFR-1 Floor invariance**: no fallback of any kind introduced (between or
  within ports); blind bundles, single-writer ledgers, fresh-context refuters,
  deterministic checker invocation untouched.
- **NFR-2 Core untouched**: zero changes to Core prompts, stage contracts,
  checker bytes, gates (Decision 0004 boundary; `core.manifest.json`
  classifications maintained; `validate-core-boundary.ts` must stay green).
- **NFR-3 Her discipline is the gate**: acceptance = loa-aleph's own
  `npm test` chain + core-boundary checker, on both platforms (Linux via her
  CI, darwin locally). Strict TypeScript; no new runtime dependencies.
- **NFR-4 Authority honesty**: all new ports ship at `planned`/`implemented`;
  PR marked draft, "implements Decision 0005, merges only on its acceptance";
  no receipt from an unsanctioned port may present as validated/sanctioned.
- **NFR-5 Sensitivity**: worker bundles never leave the machine in v1 (local
  ports only — remote-microvm deferred partly on this boundary).

> Sources: runner-capability-contract.md §Capability floor; capability-contract.md §Full-mode rule; Decision 0004; profile `required_capabilities` incl. `local_process_execution` [CODE:adapters/loa/profiles/loa-default.json].

## 6. Scope

**In (v1)**: FR-1..FR-7; parity fixtures; seatbelt profile generator + tests;
port registry; profile schema extension; receipt defaulting.

**Out (explicit)**:
- `anthropic-api` implementation (declared `planned` only).
- `container` and `remote-microvm` (Vercel Sandbox) SandboxPorts — named in
  Decision 0005 / SDD as alternatives; remote-microvm additionally changes the
  data boundary (NFR-5) and attestation surface. (Phase 5 Q2 ruling.)
- just-bash — category mismatch (in-process virtual bash, cannot contain a
  native binary; its own docs defer to Vercel Sandbox for binaries).
- Non-Claude runtimes (codex/cursor CLIs) — different runner class
  (Hermes-class second adapter); cheval remains the design-language donor,
  not a component. (Phase 4 Q1 grill ruling.)
- Any lifecycle advancement past `implemented`.
- Any loa (framework repo) change — bundle ingestion is Eileen's automation.

> Sources: Phase 6 discovery ruling + Phase 4/5 grill rulings Q1–Q2 (2026-07-19); Vercel Sandbox docs + justbash.dev (fetched 2026-07-19); Decision 0005 §Non-goals.

## 7. Risks & Dependencies

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Eileen rejects Decision 0005 or prefers another seam (e.g. Hermes-first) | Real | Draft PR = evidence, not presumption; branch converts to fork spike; #37 stands alone. Check for her review feedback BEFORE implementation starts. |
| Full deny-default Seatbelt profile breaks Keychain/mach-lookup for the CLI | Medium | Feasibility proven under write-restricted profile (PORT-PROBE-OK); profile generator developed incrementally against the live probe harness; explicit mach-lookup allows documented per Apple SBPL. |
| Seatbelt deprecated by Apple | Low near-term | Verified functional on macOS 26.3 (probe 2026-07-19); container port named as successor path. |
| Subscription CLI automation/ToS posture | Low | Operator's own authenticated seat, interactive-equivalent usage volume; flagged eyes-open in PR body. |
| stream-json usage fields insufficient for token budget | Low | Degrade to timeout+output-byte caps as documented gap (Eileen-visible), never silent. |
| Model drift mid-run under alias | Expected occasionally | FR-2 fail-closed drift kill is the designed behavior, not a failure. |

**Dependencies**: loa-aleph checkout at `origin/main` (5472292) + branch
`proposal/0005-host-portability-ports` (PR #37); operator's Mac (macOS 26.3,
claude 2.1.215, Keychain creds); Eileen's review availability for the
decision doc.

> Sources: live probes 2026-07-19 (§FR-3); loa-aleph#36/#37 states verified via gh 2026-07-19; session risk grill; Anthropic subscription posture flagged by operator latitude.

## 8. Traceability

Every FR traces to: Decision 0005 §Decision (proposed) [PR #37], the
2026-07-19 grill rulings (Phase 4 Q1–Q4), the discovery rulings (cycle slot /
DONE / port set / budget), or live probe evidence (§FR-3). Code citations
refer to loa-aleph `origin/main` @ 5472292.

> Sources: this document's per-section Sources lines; session trajectory 2026-07-19.
