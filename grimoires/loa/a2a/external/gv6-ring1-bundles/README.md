# GV6 Ring 1 — first theatre bundles (echelon-core#178)

Three `ConstructAdmissionBundle`s for the first cert-loop theatre ratified on
[AITOBIAS04/echelon-core#178](https://github.com/AITOBIAS04/echelon-core/issues/178):
the reference construct, a mid-tier construct, and a deliberately broken one.
`bundle_schema_version` **1.0.0** (pinned, #200 resolved).

| Bundle | Source | Score (C1–C9) | Fails | Why |
|---|---|---|---|---|
| `gecko/` | construct-gecko (the reference grounded construct) | **9/9** | — | reference-grade; its `reality.md` IS the `identity/environment.md` shape |
| `herald/` | construct-herald | **8/9** | C7 | ships no `identity/environment.md`; `reality.md` is an honest absence stub |
| `gecko-broken/` | gecko copy + 3 injections | **6/9** | C3, C4, C8 | invented `model_tier: quantum` · Write-capability routed through read-only `agent: Explore` · genome link 1 tampered post-mint (see its `INJECTIONS.md`) |

## The rubric

`evals/environment-design/construct-rubric.py` — the C1–C9 deterministic rubric.
**`rubric_hash = sha256:1374c7c445d8ab756e751160bb76e67f91f2cceaf4e56ba54fee3af9693ce370`**
(the sha256 of that file's committed bytes; every `registration.json` here carries
it, so any party re-derives a verdict against the exact rubric that graded it):

> **Rubric changelog** (a rubric bump is a recorded seam event, never silent):
> - **v1.0.1** `sha256:1374c7c4…93ce370` — C8 handles BOTH chain dialects: canonical
>   `LEARNINGS.jsonl` distilled-clew chains (delegated to the vendored
>   `genome-chain.py` recipe — `compute_link(parent, entry)`, bookkeeping stripped,
>   `genome_seq` order, zero-distilled = vacuous pass) and the bundle-dialect links
>   used by these theatre exemplars. Caught by a 51-construct fleet sweep: v1.0.0
>   would have spuriously failed the first bundle carrying a real construct genome.
> - **v1.0.0** `sha256:c181978e…d52af9df` — initial pin (bundle dialect only), as
>   posted in the theatre-1 handover.

```
python3 evals/environment-design/construct-rubric.py grade --bundle <dir> --json
python3 evals/environment-design/construct-rubric.py rubric-hash
```

Machine-readable verdicts for all three bundles: `grades/*.json`.

## Disclosures (structural, not prose)

- **`proof-of-run.json` is a self-baseline** — `verifier_type:
  "self_baseline_bundle_recompute"` (the Echelon §6.6 `frozen_replay_baseline`
  pattern). No governed compose-verify run was minted; the attestation covers
  only deterministic assembly + content_hash recomputation. C9 makes
  `verifier_type` REQUIRED: synthetic is admissible, undisclosed synthetic is not.
- **Genome chains are fabricated 2-link exemplars** — neither gecko nor herald
  ships an in-repo `LEARNINGS.jsonl` yet. They exercise the chain VERIFIER
  (including the tamper direction in `gecko-broken`); they do not represent
  earned authority.
- **`gecko-broken` registers under a distinct slug** while its manifest keeps
  `slug: gecko` (it is a tampered copy of gecko — that is the point); the
  registration identity is distinct so the registry never collides.

## Hash recipes

- `content_hash` (in `registration.json` + `proof-of-run.json`): see each
  bundle's `HASHING.md` — sorted `sha256  relpath` listing over core members
  (manifest, reality, handoff, SKILL.md files), sidecars excluded.
- genome link hash: `sha256hex(jcs(link minus its genome_hash field))`,
  `jcs = loa_cheval.jcs.canonicalize` (RFC 8785) — the same core as the
  audit-envelope chain and the GV6 cert gate (Ring 0, loa-freeside PR #435).
