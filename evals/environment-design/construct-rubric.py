#!/usr/bin/env python3
"""
construct-rubric.py — the C1–C9 construct-admission rubric (issue
AITOBIAS04/echelon-core#178, Ring 1 theatre).

Grades a ConstructAdmissionBundle directory against the 9 deterministic checks
ratified on #178: file-only, crisp pass/fail, zero LLM, zero network. This file
IS the rubric — `rubric_hash` in a bundle's registration payload is the sha256
of this file's committed bytes, so a cert names the exact rubric that graded it
and any party can re-derive the verdict.

Bundle layout (bundle_schema_version 1.0.0):
  manifest.json       construct.yaml mapped 1:1 to JSON (schema_version 3)
  SKILL.md            primary skill (optional if skills/**/SKILL.md present)
  skills/**/SKILL.md  per-skill files
  reality.md          harness-grounding file (identity/environment.md axis)
  handoff.md          seam/handoff contract
  genome.jsonl        learning-ledger hash chain (see C8 recipe below)
  proof-of-run.json   run attestation (see C9)
  registration.json   {slug, version, content_hash, skill_manifest,
                       domain_claims, rubric_hash}

The 9 checks:
  C1 manifest parses
  C2 registry-required fields present (schema_version/name/slug/version)
  C3 model_tier in the SoT vocabulary — read LIVE from
     .claude/defaults/model-config.yaml aliases (never a carried copy), plus
     the hounfour tier equivalences reconciled 2026-06-07
     (cheap/mid≡sonnet · tiny≡haiku · max≡opus)
  C4 write capability never routes through a read-only agent type
     (the #553 silent-output-drop class)
  C5 capability declarations match the toolset
     (capabilities.write_files:false + Write/Edit tool = fail)
  C6 skill prose uses canonical primitives (`br` for tasks, `ck` for search —
     no `bd`, no raw grep/rg code-search)
  C7 grounding file exists (reality.md axis; an honest absence stub marked
     "ABSENT IN SOURCE" is a FAIL — honesty changes the verdict's meaning,
     not its direction)
  C8 genome hash chain verifies, recomputed from genesis. TWO dialects, each
     with its exact minting recipe (rubric v1.0.1 — the fleet sweep caught the
     v1.0.0 seam where a canonical chain would fail spuriously):
       * canonical LEARNINGS dialect (any line carries distill_status):
         delegated to the vendored genome-chain.py — distilled clews in
         genome_seq order, link = compute_link(parent, entry) =
         "sha256:" + sha256hex(jcs({parent, entry minus bookkeeping})),
         parent = "genesis" at depth 1. Zero distilled links = vacuous pass
         (canonical verifier semantics), stated in the reason.
       * bundle dialect (theatre exemplars):
         link.genome_hash == sha256hex(jcs(link minus its genome_hash field)),
         link.parent_hash == previous link's genome_hash (first: "GENESIS").
     jcs = loa_cheval.jcs.canonicalize (RFC 8785) — the same core as the
     audit-envelope, genome, and GV6 cert chains. Tamper = fail in both.
  C9 proof-of-run: verdict == "valid_run" AND content_hash_verified recomputes
     over the core members AND verifier_type is present. verifier_type is
     REQUIRED so a self-baseline can never pass silently — the Echelon §6.6
     pattern (frozen_replay_baseline): synthetic is admissible, undisclosed
     synthetic is not.

content_hash recipe (C9, mirrors each bundle's HASHING.md):
  core = [manifest.json, reality.md, handoff.md] + sorted(skills/**/SKILL.md)
         + SKILL.md if present at bundle root
  listing = "".join(f"{sha256hex(bytes(m))}  {relpath}\n" for m in sorted-by-relpath)
  content_hash = sha256hex(listing)

Read-only agent types (C4) mirror WRITE_CAPABLE_AGENTS in
validate-skill-capabilities.sh: Plan and Explore exclude Write/Edit.

Usage:
  construct-rubric.py grade --bundle <dir> [--json]
  construct-rubric.py rubric-hash          # sha256 of this file (the pin)

Exit: 0 all checks pass · 1 one or more fail · 2 usage/malformed bundle ·
      70 cannot import loa_cheval.jcs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path


def _find_adapters() -> "Path | None":
    env = os.environ.get("LOA_GENOME_ADAPTERS")
    if env and (Path(env) / "loa_cheval" / "jcs.py").is_file():
        return Path(env)
    here = Path(__file__).resolve()
    for base in [here.parent, here.parent.parent, *here.parents]:
        for cand in (base / "adapters", base / ".claude" / "adapters"):
            if (cand / "loa_cheval" / "jcs.py").is_file():
                return cand
    return None


_ADAPTERS = _find_adapters()
if _ADAPTERS is not None:
    sys.path.insert(0, str(_ADAPTERS))

try:
    from loa_cheval.jcs import canonicalize as _jcs
except Exception as exc:
    print(f"construct-rubric: FATAL — cannot import loa_cheval.jcs: {exc}", file=sys.stderr)
    sys.exit(70)

READ_ONLY_AGENTS = {"Plan", "Explore"}
WRITE_TOOLS = {"Write", "Edit", "NotebookEdit"}
# hounfour tier equivalences (reconciled 2026-06-07: cheap≡sonnet NOT haiku);
# unioned with the LIVE alias keys read from model-config.yaml at grade time.
HOUNFOUR_TIER_NAMES = {"cheap", "mid", "tiny", "max", "opus", "sonnet", "haiku"}


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canon_bytes(value) -> bytes:
    out = _jcs(value)
    return out if isinstance(out, bytes) else out.encode("utf-8")


def genome_link_hash(link: dict) -> str:
    body = {k: v for k, v in link.items() if k != "genome_hash"}
    return _sha256_hex(_canon_bytes(body))


def _canonical_genome():
    """The vendored genome-chain.py (same dir), imported once — never reinvent."""
    import importlib.util
    path = Path(__file__).resolve().parent / "genome-chain.py"
    spec = importlib.util.spec_from_file_location("genome_chain", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _verify_canonical_chain(genome_path: Path) -> "tuple[bool, str]":
    """LEARNINGS-dialect verify, delegated to genome-chain.py's recipe."""
    gc = _canonical_genome()
    distilled = gc._read_distilled(genome_path)
    if not distilled:
        return True, "canonical dialect: 0 distilled links — vacuously valid (no earned authority yet)"
    parent, problems = gc.GENESIS, []
    for i, entry in enumerate(distilled):
        recomputed = gc.compute_link(parent, entry)
        if entry.get("genome_hash") != recomputed:
            problems.append(f"distilled link {i + 1}: stored genome_hash != recompute")
        parent = entry.get("genome_hash")
    if problems:
        return False, "canonical dialect: " + "; ".join(problems)
    return True, f"canonical dialect: {len(distilled)}-link chain recomputes from genesis"


def _sot_vocabulary() -> "set[str] | None":
    """Alias keys read live from the model-config SoT, or None if unreadable."""
    here = Path(__file__).resolve()
    for base in [here.parent, *here.parents]:
        cfg = base / ".claude" / "defaults" / "model-config.yaml"
        if cfg.is_file():
            in_aliases, keys = False, set()
            for line in cfg.read_text().splitlines():
                if re.match(r"^aliases:\s*$", line):
                    in_aliases = True
                    continue
                if in_aliases:
                    if line.strip() and not line.startswith(" "):
                        break  # left the aliases block
                    m = re.match(r"^  ([A-Za-z0-9_.-]+):", line)
                    if m:
                        keys.add(m.group(1))
            return keys | HOUNFOUR_TIER_NAMES
    return None


def _frontmatter(text: str) -> dict:
    """Minimal targeted frontmatter read: agent, allowed-tools, write_files."""
    fm: dict = {}
    if not text.startswith("---"):
        return fm
    body = text.split("---", 2)
    if len(body) < 3:
        return fm
    for line in body[1].splitlines():
        m = re.match(r"^agent:\s*(\S+)", line)
        if m:
            fm["agent"] = m.group(1).strip("'\"")
        m = re.match(r"^allowed-tools:\s*\[(.*)\]", line)
        if m:
            fm["allowed-tools"] = [t.strip().strip("'\"") for t in m.group(1).split(",")]
        m = re.match(r"^\s*write_files:\s*(true|false)", line)
        if m:
            fm["write_files"] = m.group(1) == "true"
    return fm


def _skill_files(bundle: Path) -> "list[Path]":
    files = sorted(bundle.glob("skills/**/SKILL.md"))
    if (bundle / "SKILL.md").is_file():
        files.insert(0, bundle / "SKILL.md")
    return files


def _core_members(bundle: Path) -> "list[Path]":
    members = [bundle / n for n in ("manifest.json", "reality.md", "handoff.md")
               if (bundle / n).is_file()]
    members += _skill_files(bundle)
    return sorted(set(members), key=lambda p: p.relative_to(bundle).as_posix())


def content_hash(bundle: Path) -> str:
    listing = "".join(
        f"{_sha256_hex(m.read_bytes())}  {m.relative_to(bundle).as_posix()}\n"
        for m in _core_members(bundle))
    return _sha256_hex(listing.encode("utf-8"))


# Canonical-primitive violations (C6): bd task commands; raw recursive
# grep / bare rg code-search. `--grep` (git log) and prose mentions survive.
_BD_RE = re.compile(r"(?m)^\s*(?:\$ )?bd\s+(create|update|close|ready|list|show|sync)\b")
_GREP_RE = re.compile(r"(?m)^\s*(?:\$ )?(?:rg|grep\s+-[a-zA-Z]*r)\s+\S")


def grade(bundle: Path) -> dict:
    checks: list[dict] = []

    def check(cid: str, name: str, ok: bool, reason: str) -> None:
        checks.append({"check_id": cid, "name": name,
                       "status": "pass" if ok else "fail", "reason": reason})

    # C1 + C2 — manifest
    manifest = None
    try:
        manifest = json.loads((bundle / "manifest.json").read_text())
        check("C1", "manifest_parses", True, "manifest.json is valid JSON")
    except Exception as exc:
        check("C1", "manifest_parses", False, f"{exc}")
    if manifest is not None:
        missing = [f for f in ("schema_version", "name", "slug", "version")
                   if f not in manifest]
        check("C2", "registry_required_fields", not missing,
              "all present" if not missing else f"missing: {missing}")
    else:
        check("C2", "registry_required_fields", False, "no parsed manifest")

    # C3 — model_tier in SoT vocabulary (live read)
    vocab = _sot_vocabulary()
    tier = (manifest or {}).get("capabilities", {}).get("model_tier")
    if vocab is None:
        check("C3", "model_tier_in_sot", False,
              "SOT_UNREACHABLE: model-config.yaml not found (indeterminate → fail-closed)")
    elif tier is None:
        check("C3", "model_tier_in_sot", True, "no model_tier declared (nothing to validate)")
    else:
        check("C3", "model_tier_in_sot", tier in vocab,
              f"model_tier '{tier}' {'in' if tier in vocab else 'NOT in'} live SoT vocabulary")

    # C4 + C5 — per-skill frontmatter
    c4_bad, c5_bad = [], []
    for sf in _skill_files(bundle):
        fm = _frontmatter(sf.read_text())
        tools = set(fm.get("allowed-tools", []))
        writes = bool(tools & WRITE_TOOLS) or fm.get("write_files") is True
        if writes and fm.get("agent") in READ_ONLY_AGENTS:
            c4_bad.append(f"{sf.relative_to(bundle)} (agent: {fm['agent']})")
        if fm.get("write_files") is False and tools & WRITE_TOOLS:
            c5_bad.append(str(sf.relative_to(bundle)))
    check("C4", "no_write_through_readonly_agent", not c4_bad,
          "no write-capable skill routes through a read-only agent type"
          if not c4_bad else f"write capability on read-only agent: {c4_bad}")
    check("C5", "capabilities_match_toolset", not c5_bad,
          "declarations consistent with toolsets"
          if not c5_bad else f"write_files:false but Write/Edit tools: {c5_bad}")

    # C6 — canonical primitives in skill prose
    c6_bad = []
    for sf in _skill_files(bundle):
        text = sf.read_text()
        if _BD_RE.search(text) or _GREP_RE.search(text):
            c6_bad.append(str(sf.relative_to(bundle)))
    check("C6", "canonical_primitives", not c6_bad,
          "no bd task commands, no raw recursive-grep/rg code-search"
          if not c6_bad else f"non-canonical primitives in: {c6_bad}")

    # C7 — grounding file
    reality = bundle / "reality.md"
    if not reality.is_file():
        check("C7", "grounding_file_exists", False, "reality.md absent")
    elif "ABSENT IN SOURCE" in reality.read_text()[:200]:
        check("C7", "grounding_file_exists", False,
              "reality.md is an honest absence stub — no grounding file in source")
    else:
        check("C7", "grounding_file_exists", True, "reality.md present")

    # C8 — genome hash chain (two dialects; see module docstring)
    genome = bundle / "genome.jsonl"
    if not genome.is_file():
        check("C8", "genome_chain_verifies", False, "genome.jsonl absent")
    else:
        lines = [json.loads(l) for l in genome.read_text().splitlines() if l.strip()]
        if any("distill_status" in l for l in lines):
            ok, reason = _verify_canonical_chain(genome)
            check("C8", "genome_chain_verifies", ok, reason)
        else:
            problems, parent = [], "GENESIS"
            for i, link in enumerate(lines):
                if link.get("parent_hash") != parent:
                    problems.append(f"link {i + 1}: parent_hash != previous genome_hash")
                recomputed = genome_link_hash(link)
                if link.get("genome_hash") != recomputed:
                    problems.append(f"link {i + 1}: stored genome_hash != recompute")
                parent = link.get("genome_hash")
            check("C8", "genome_chain_verifies", not problems,
                  "bundle dialect: chain recomputes from genesis"
                  if not problems else "bundle dialect: " + "; ".join(problems))

    # C9 — proof-of-run
    por_path = bundle / "proof-of-run.json"
    if not por_path.is_file():
        check("C9", "proof_of_run", False, "proof-of-run.json absent (no trace = roleplay)")
    else:
        try:
            por = json.loads(por_path.read_text())
            reasons = []
            if por.get("verdict") != "valid_run":
                reasons.append(f"verdict '{por.get('verdict')}' != valid_run")
            if not por.get("verifier_type"):
                reasons.append("verifier_type absent — undisclosed provenance never passes")
            actual = content_hash(bundle)
            if por.get("content_hash_verified") != actual:
                reasons.append(f"content_hash_verified does not recompute (actual {actual[:16]}…)")
            check("C9", "proof_of_run", not reasons,
                  f"valid_run · verifier_type={por.get('verifier_type')} · content_hash recomputes"
                  if not reasons else "; ".join(reasons))
        except Exception as exc:
            check("C9", "proof_of_run", False, f"unreadable: {exc}")

    passed = sum(1 for c in checks if c["status"] == "pass")
    return {"bundle": bundle.name, "score": f"{passed}/9", "passed": passed,
            "rubric_hash": "sha256:" + _sha256_hex(Path(__file__).read_bytes()),
            "checks": checks}


def main() -> int:
    p = argparse.ArgumentParser(description="C1–C9 construct-admission rubric")
    sub = p.add_subparsers(dest="cmd", required=True)
    pg = sub.add_parser("grade")
    pg.add_argument("--bundle", required=True)
    pg.add_argument("--json", action="store_true")
    sub.add_parser("rubric-hash")
    args = p.parse_args()

    if args.cmd == "rubric-hash":
        print("sha256:" + _sha256_hex(Path(__file__).read_bytes()))
        return 0

    bundle = Path(args.bundle)
    if not bundle.is_dir():
        print(f"construct-rubric: not a directory: {bundle}", file=sys.stderr)
        return 2
    result = grade(bundle)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for c in result["checks"]:
            print(f"{c['check_id']} {'PASS' if c['status'] == 'pass' else 'FAIL'}  "
                  f"{c['name']} — {c['reason']}")
        print(f"\n{result['bundle']}: {result['score']}")
    return 0 if result["passed"] == 9 else 1


if __name__ == "__main__":
    sys.exit(main())
