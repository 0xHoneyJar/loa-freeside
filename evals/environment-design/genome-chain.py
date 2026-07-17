#!/usr/bin/env python3
"""
genome-chain.py — the construct genome-hash-chain core (bd-uze / Track A).

Earned construct authority materialized as a hash chain: each operator-merged
clew (correction), distilled via `/clew` drain (--mark-distilled), extends the
construct's genome by one link. Chain DEPTH = conviction = earned authority.
Git is the blockchain; the merge commit that lands the new genome_hash is the
operator's signature.

This module is the REUSABLE core, called by two consumers:
  * the crs drain (loa-clew-distill.sh --mark-distilled) — computes the next link
  * the genome-integrity eval (Track B / B7) — verifies a construct's whole chain

Hash primitive REUSE (noether: never reinvent crypto): the link hash is
  genome_hash = "sha256:" + sha256( jcs_canonicalize({parent, entry}) )
where jcs_canonicalize is loa_cheval.jcs.canonicalize (RFC 8785), the SAME
canonicalizer the audit-envelope hash chain uses. `entry` is the clew's
immutable teaching payload (the mutable distill-bookkeeping fields are stripped
so re-verification is deterministic). The chain is re-verifiable from the
LEARNINGS.jsonl walk alone — no stored signatures, no external state.

Incorruptibility is NOT enforced here — it is enforced upstream at admission
(loa-clew-distill.sh A3): a clew enters the genome ONLY if it carries a run_id
with a `valid_run` verdict from compose-verify-run. A roleplayed correction
(no run_id / not_a_run) is quarantined to SUSPECTS.jsonl and never reaches this
module. genome-chain.py assumes its inputs already passed admission; it is the
arithmetic, not the gate.

Usage:
  genome-chain.py compute --parent <sha256:...|genesis> --entry-file <path>
      → prints the next genome_hash ("sha256:<64hex>") on stdout

  genome-chain.py verify --construct-yaml <path> --learnings <path> [--json]
      → walks distilled clews (ordered by distilled_at), recomputes the chain
        from genesis, asserts: each entry's stored genome_hash == recomputed
        link · the final link == construct.yaml genome_hash · the link count ==
        construct.yaml genome_depth.
      → exit 0 ok · 1 mismatch/broken chain · 2 usage

The mutable distill-bookkeeping fields stripped from the hash payload:
  distill_status, distilled_at, genome_hash, proposed_pr
(everything else — id, trigger, target, captured_at, run_id, … — is the
immutable teaching identity that the genome commits to.)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

# --- reuse the canonical RFC-8785 core (never reinvent) ----------------------
# Canonical home: loa-constructs/.claude/scripts/genome-chain.py (loa_cheval lives
# at loa-constructs/.claude/adapters/). This file is ALSO vendored byte-identical
# into loa-freeside (evals/environment-design/) for the genome-integrity eval — so
# the adapters resolver walks UP from the script looking for a loa_cheval, working
# unmodified in either layout (a vendored copy that differs is a drift bug; the
# eval hash-checks it). LOA_GENOME_ADAPTERS overrides for unusual installs.
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
    from loa_cheval.jcs import canonicalize as _jcs_canonicalize
except Exception as exc:  # fail LOUD — cannot compute genome without the core
    sys.stderr.write(
        "genome-chain: FATAL — cannot import loa_cheval.jcs (the RFC-8785 core); "
        f"searched up from {Path(__file__).resolve().parent} (found: {_ADAPTERS}): {exc}\n"
        "The genome chain reuses the audit-envelope canonicalizer; it is never "
        "reinvented. Run from loa-constructs/loa-freeside or set LOA_GENOME_ADAPTERS.\n"
    )
    sys.exit(70)

GENESIS = "genesis"
_HASH_RE = "^sha256:[0-9a-f]{64}$"

# Mutable distill-bookkeeping fields — excluded from the hash payload so the
# chain re-verifies deterministically regardless of bookkeeping rewrites.
# (genome_seq is the chain-order index stamped at admission; it is bookkeeping,
# NOT teaching content — must be stripped or it would perturb the hash.)
_MUTABLE_FIELDS = {"distill_status", "distilled_at", "genome_hash", "genome_seq", "proposed_pr"}


def _genome_payload(entry: dict) -> dict:
    """The immutable teaching identity the genome commits to."""
    return {k: v for k, v in entry.items() if k not in _MUTABLE_FIELDS}


def compute_link(parent: str, entry: dict) -> str:
    """
    Compute the next genome_hash from the parent head + a clew entry.

    parent: the prior head ("sha256:<hex>") or the literal "genesis" at depth 1.
    entry:  the full clew ledger entry (mutable fields are stripped internally).
    """
    if parent != GENESIS and not _is_hash(parent):
        raise ValueError(
            f"parent must be 'genesis' or a sha256:<64hex> hash, got {parent!r}"
        )
    link_input = {"parent": parent, "entry": _genome_payload(entry)}
    digest = hashlib.sha256(_jcs_canonicalize(link_input)).hexdigest()
    return f"sha256:{digest}"


def _is_hash(value) -> bool:
    import re

    return isinstance(value, str) and re.match(_HASH_RE, value) is not None


def _load_yaml(path: Path) -> dict:
    try:
        import yaml
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"genome-chain: PyYAML required to read {path}: {exc}\n")
        sys.exit(70)
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _read_distilled(learnings_path: Path) -> list[dict]:
    """
    All distilled clews from a LEARNINGS.jsonl, in CHAIN ORDER.

    Ordered by `genome_seq` — the authoritative distillation index (= the depth the
    clew produced), stamped at admission. Sorting by the mutable `distilled_at`
    timestamp alone is fragile (clock skew / same-second ties / a manual edit can
    reorder the walk and report a broken chain on a valid ledger) — cross-model
    review escalation. `distilled_at`/`id` are only tiebreakers for legacy entries
    lacking genome_seq.
    """
    out: list[dict] = []
    if not learnings_path.is_file():
        return out
    with learnings_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("distill_status") == "distilled":
                out.append(d)
    _BIG = 1_000_000_000
    out.sort(key=lambda d: (
        d.get("genome_seq") if isinstance(d.get("genome_seq"), int) else _BIG,
        d.get("distilled_at") or "",
        d.get("id") or "",
    ))
    return out


def _verify(construct_yaml: Path, learnings: Path, as_json: bool) -> int:
    manifest = _load_yaml(construct_yaml) if construct_yaml.is_file() else {}
    claimed_head = manifest.get("genome_hash")
    claimed_depth = manifest.get("genome_depth")

    claimed_parent = manifest.get("parent_genome_hash")
    distilled = _read_distilled(learnings)

    problems: list[str] = []
    parent = GENESIS
    penult = GENESIS  # the parent of the most recent link (the penultimate head)
    for i, entry in enumerate(distilled):
        # genome_seq is REQUIRED and must be CONTIGUOUS 1..N (it IS the chain index). A
        # missing, duplicate, or gapped seq is rejected — a missing one would let a
        # distilled entry skip the ordering invariant (cross-model iter-3, codex MED;
        # the genome feature is new, so there are no legacy distilled entries to grandfather).
        seq = entry.get("genome_seq")
        if not isinstance(seq, int) or seq != i + 1:
            problems.append(
                f"link {i + 1} ({entry.get('id')}): genome_seq {seq!r} != expected {i + 1} "
                f"(missing / non-contiguous / duplicate chain index)"
            )
        link = compute_link(parent, entry)
        stored = entry.get("genome_hash")
        if stored != link:
            problems.append(
                f"link {i + 1} ({entry.get('id')}): stored genome_hash {stored} "
                f"!= recomputed {link}"
            )
        penult = parent
        parent = link

    recomputed_head = parent if distilled else None
    recomputed_depth = len(distilled)
    # The manifest's parent_genome_hash must equal the PENULTIMATE link (the head
    # before the last distilled clew) — absent at depth 1 (penult == genesis). Without
    # this, construct.yaml can carry a forged/stale parent while head+depth still pass
    # (cross-model review: codex MED / gemini HIGH).
    expected_parent = None if (not distilled or penult == GENESIS) else penult

    # genesis (no distilled clews): head + depth + parent must ALL be absent/0.
    if not distilled:
        if claimed_head is not None:
            problems.append(
                f"no distilled clews but construct.yaml carries genome_hash "
                f"{claimed_head} (should be absent at depth 0)"
            )
        if claimed_depth not in (None, 0):
            problems.append(
                f"no distilled clews but genome_depth={claimed_depth} (should be "
                f"absent or 0)"
            )
        if claimed_parent is not None:
            # A stale parent_genome_hash at depth 0 is unanchored provenance
            # (cross-model iter-2, codex LOW).
            problems.append(
                f"no distilled clews but construct.yaml carries parent_genome_hash "
                f"{claimed_parent} (should be absent at depth 0)"
            )
    else:
        if claimed_head != recomputed_head:
            problems.append(
                f"construct.yaml genome_hash {claimed_head} != recomputed chain "
                f"head {recomputed_head}"
            )
        if claimed_depth != recomputed_depth:
            problems.append(
                f"construct.yaml genome_depth {claimed_depth} != distilled-clew "
                f"count {recomputed_depth}"
            )
        if claimed_parent != expected_parent:
            problems.append(
                f"construct.yaml parent_genome_hash {claimed_parent} != penultimate "
                f"link {expected_parent} (forged/stale parent — head+depth alone do "
                f"not pin the prior link)"
            )

    ok = not problems
    if as_json:
        print(
            json.dumps(
                {
                    "ok": ok,
                    "construct_yaml": str(construct_yaml),
                    "claimed_head": claimed_head,
                    "recomputed_head": recomputed_head,
                    "claimed_depth": claimed_depth,
                    "recomputed_depth": recomputed_depth,
                    "problems": problems,
                },
                separators=(",", ":"),
            )
        )
    else:
        if ok:
            print(
                f"genome-chain: OK — {recomputed_depth} link(s), head "
                f"{recomputed_head or '(genesis/empty)'}"
            )
        else:
            sys.stderr.write("genome-chain: BROKEN CHAIN\n")
            for p in problems:
                sys.stderr.write(f"  ✗ {p}\n")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="genome-chain.py", add_help=True)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("compute", help="compute the next genome_hash")
    c.add_argument("--parent", required=True, help="parent head or 'genesis'")
    c.add_argument(
        "--entry-file",
        required=True,
        help="path to the clew entry JSON (use '-' for stdin)",
    )

    v = sub.add_parser("verify", help="verify a construct's genome chain")
    v.add_argument("--construct-yaml", required=True)
    v.add_argument("--learnings", required=True)
    v.add_argument("--json", action="store_true")

    # depth (A4, SHADOW-first): the programmatic reader a future compose-router
    # consumes to make genome DEPTH a routing/earned-tier preference. SHADOW means
    # this READS + REPORTS conviction; it does NOT route. `routed:false` is explicit
    # so a consumer cannot mistake the shadow signal for an active routing decision.
    d = sub.add_parser("depth", help="read a construct's genome depth (shadow routing signal)")
    d.add_argument("--construct-yaml", required=True)
    d.add_argument("--json", action="store_true")

    args = ap.parse_args(argv)

    if args.cmd == "compute":
        if args.entry_file == "-":
            entry = json.loads(sys.stdin.read())
        else:
            entry = json.loads(Path(args.entry_file).read_text(encoding="utf-8"))
        try:
            print(compute_link(args.parent, entry))
        except ValueError as exc:
            sys.stderr.write(f"genome-chain: {exc}\n")
            return 2
        return 0

    if args.cmd == "verify":
        return _verify(Path(args.construct_yaml), Path(args.learnings), args.json)

    if args.cmd == "depth":
        cy = Path(args.construct_yaml)
        manifest = _load_yaml(cy) if cy.is_file() else {}
        slug = manifest.get("slug")
        depth = manifest.get("genome_depth") or 0
        head = manifest.get("genome_hash")
        # SHADOW preference (advisory only; the router does NOT yet consume this).
        # A 0-depth construct is the unproven/risky choice; deeper = more earned
        # conviction. The router will later map depth -> routing preference + earned
        # downgrade_allowed — but routed stays false until that step ships (fork #3).
        signal = {
            "slug": slug,
            "genome_depth": depth,
            "genome_hash": head,
            "shadow_preference": ("proven" if depth >= 3 else "emerging" if depth >= 1 else "unproven"),
            "routed": False,
        }
        if args.json:
            print(json.dumps(signal, separators=(",", ":")))
        else:
            print(f"genome-depth {depth} · {signal['shadow_preference']} · routed=false (shadow) · {slug or '?'}")
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
