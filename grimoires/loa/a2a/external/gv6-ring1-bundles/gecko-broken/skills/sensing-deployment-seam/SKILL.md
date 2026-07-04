---
name: sensing-deployment-seam
description: >
  GECKO's 4th eye — the deployment-seam coherence sensor. The first three eyes
  look INSIDE a construct (identity-reality, composition-authority, runtime-fit);
  this one looks AT THE SEAM between where the Loa framework PUTS things (the SoT
  roots in ~/.loa/deployment.yaml) and where each harness consumer LOOKS for them.
  It senses the manifest-numbness / scattered-symlink / source-vs-installed-lag
  class: a consumer expecting an artifact at a root the producer placed elsewhere,
  silently, until a dispatch breaks. Sense-only. CONFLICT (hard, path-provable) vs
  SMELL (soft). Use when the same deployment incoherence keeps recurring, after a
  framework/harness layout change, or as a periodic sweep.
allowed-tools: [Bash, Read, Grep, Glob]
agent: construct-gecko
user-invocable: true
capabilities:
  schema_version: 1
  write_files: false
  web_access: false
cost-profile: lightweight
role: review
---

# sensing-deployment-seam — the 4th eye

> Authored 2026-06-08 from the `audit-ecosystem-coherence` Opus review. The estate
> kept re-discovering the same incoherence (manifest-numbness, the `.loa`↔`.claude`
> path-split, ghost constructs, the sensor that wasn't installed) and patching the
> instance. This eye senses the CLASS so it is caught before a dispatch breaks.

## The model (operator decision 2026-06-08): single global SoT

`~/.loa/deployment.yaml` names the canonical roots once — `packs / agents / template
/ runtime / compositions / schema`. Any consumer reading a DIFFERENT pack root is a
CONFLICT, not a legitimate scope. The eye READS that SoT (so it tracks the home
automatically and says so when the manifest is absent — a doctor that doctors its
own map).

## What it senses

- **SEAM-ROOT** — every pack-root consumer must resolve to `packs_root`. The global
  registration path (`adapter-generator.py`) is probed for its resolved `PACKS_DIR`;
  any script that hardcodes a non-SoT pack root via path-arithmetic is a CONFLICT;
  a band-aid symlink bridging the divergence is a SMELL (it encodes the bug).
- **SEAM-INSTALL-LAG** — pack-bundled scope only. (a) the installed pack must ship
  every pack-bundled skill IT declares; (b) the installed pack must not LAG its
  source repo's pack-bundled skills (the `sensing-runtime-fit-not-installed` class
  this very eye was born from). Harness-installed skills (`path: .claude/skills/…`)
  are a different scope and are NOT pack lag.

## Run it

```bash
python3 "$(dirname "$0")/sense.py"          # human-readable
python3 "$(dirname "$0")/sense.py" --json   # structured (for patrol / the wall)
```

Exit code is the finding count (for scripting); it NEVER gates — same firewall as
GECKO's other eyes: it names the mismatch, grants no authority, mutates nothing.
The fixing is a separate, operator-paced act.

## Composes with

- `sensing-runtime-fit` — the intra-construct capability-reality eye; this is its
  inter-construct, seam-level sibling.
- `patrol` — wire `sense.py --json` into the network loop so deployment-seam drift
  reaches the wall.
- The deployment SoT (`~/.loa/deployment.yaml`) — the truth this eye reads and checks
  every consumer against.
