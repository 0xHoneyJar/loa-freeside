#!/usr/bin/env python3
"""
fleet-sweep.py — the C7/C8 grounding sweep over construct source repos
(cycle-construct-grounding-c7, PRD NFR-2: the close-gate must be reproducible,
not a session-scratchpad script).

Walks every `construct-*` source repo and emits, per repo:

  C7 axis — grounding:
    present                    identity/environment.md exists
    citation_present           file contains the literal the-ground.md URL
    no_copied_shared_sections  file contains NONE of the five shared H2 titles
                               and no `## I.`–`## V.` roman-numeral headings
                               (cite, don't clone — NFR-1)
    not_absence_stub           first 200 bytes lack the absence marker
                               (mirrors rubric C7 — the marker is READ from
                               construct-rubric.py, not carried)
    probe_manifest_present     header carries `@ <7-to-40-hex sha>` — the
                               territory-derived probe manifest (SDD D-2)

  C8 axis — earned authority:
    if construct.yaml mentions genome_hash, shell out to the CANONICAL
    verifier (`genome-chain.py verify`) — never a reimplementation. Absent
    chain = honest `no_chain`, not a failure.

HARD CONSTRAINT (SDD D-4): construct-rubric.py is byte-frozen this cycle — its
sha256 is pinned as `rubric_hash` on echelon-core#178. This driver LOADS it via
importlib for shared semantics and NEVER modifies it.

Repo discovery (SDD OQ-2 — settled by "whichever needs no new parser"):
default = glob `construct-*` under --src-root; explicit list via --repos FILE
(one repo dir name or path per line, `#` comments allowed). The loa-constructs
registry is YAML and would need a parser this script doesn't carry.

Usage:
  fleet-sweep.py [--src-root ~/Documents/GitHub] [--repos FILE] [--json]
Exit: 0 always for a completed sweep (it is a sensor, not a gate — gates read
its JSON); 2 usage error; 70 rubric module unloadable.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

GROUND_URL = "https://github.com/0xHoneyJar/loa-constructs/blob/main/docs/the-ground.md"

# The five shared H2 titles (SDD D-2 no_copied_shared_sections) + roman headings.
SHARED_H2_TITLES = [
    "Intelligence tiers",
    "Forks & isolation",
    "Agent types & tool allowlists",
    "frontmatter contracts",
    "How the gates are designed",
]
ROMAN_H2_RE = re.compile(r"(?m)^## (I|II|III|IV|V)\. ")
PROBE_SHA_RE = re.compile(r"@ [0-9a-f]{7,40}\b")


def _load_rubric():
    """Load the byte-frozen rubric module for shared semantics (never edited)."""
    path = HERE / "construct-rubric.py"
    if not path.is_file():
        print(f"fleet-sweep: FATAL — rubric module absent: {path}", file=sys.stderr)
        sys.exit(70)
    spec = importlib.util.spec_from_file_location("construct_rubric", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_c7(env_path: Path) -> dict:
    """The presence + 4 D-2 conformance checks for one environment.md."""
    if not env_path.is_file():
        return {"present": False}
    text = env_path.read_text(encoding="utf-8", errors="replace")
    head = text[:200]
    header = text[:1200]  # probe manifest lives in the header block
    copied = [t for t in SHARED_H2_TITLES if re.search(rf"(?mi)^## .*{re.escape(t)}", text)]
    if ROMAN_H2_RE.search(text):
        copied.append("roman-numeral shared heading")
    return {
        "present": True,
        "citation_present": GROUND_URL in text,
        "no_copied_shared_sections": not copied,
        "copied_sections": copied,
        "not_absence_stub": "ABSENT IN SOURCE" not in head,
        "probe_manifest_present": bool(PROBE_SHA_RE.search(header)),
    }


def c7_pass(c7: dict) -> bool:
    return bool(
        c7.get("present")
        and c7.get("citation_present")
        and c7.get("no_copied_shared_sections")
        and c7.get("not_absence_stub")
        and c7.get("probe_manifest_present")
    )


def check_c8(repo: Path) -> dict:
    """Canonical-dialect chain verify, delegated to genome-chain.py."""
    cy = repo / "construct.yaml"
    lj = repo / "LEARNINGS.jsonl"
    if not cy.is_file() or "genome_hash" not in cy.read_text(errors="replace"):
        return {"status": "no_chain", "detail": "construct.yaml carries no genome_hash"}
    gc = HERE / "genome-chain.py"
    r = subprocess.run(
        [sys.executable, str(gc), "verify", "--construct-yaml", str(cy),
         "--learnings", str(lj), "--json"],
        capture_output=True, text=True)
    if r.returncode == 70:
        return {"status": "error", "detail": "verifier could not load loa_cheval.jcs"}
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"status": "error", "detail": (r.stderr or r.stdout)[:200]}
    return {"status": "verified" if out.get("ok") else "BROKEN",
            "depth": out.get("recomputed_depth"), "problems": out.get("problems", [])}


def discover_repos(src_root: Path, repos_file: "Path | None") -> "list[Path]":
    if repos_file:
        repos = []
        for line in repos_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            p = Path(line).expanduser()
            repos.append(p if p.is_absolute() else src_root / line)
        return repos
    return sorted(p for p in src_root.glob("construct-*") if p.is_dir())


def main() -> int:
    ap = argparse.ArgumentParser(description="C7/C8 grounding sweep over construct repos")
    ap.add_argument("--src-root", default="~/Documents/GitHub")
    ap.add_argument("--repos", type=Path, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rubric = _load_rubric()  # loaded for pinned semantics; also fails loud pre-sweep
    src_root = Path(args.src_root).expanduser()
    if not src_root.is_dir():
        print(f"fleet-sweep: src-root not a directory: {src_root}", file=sys.stderr)
        return 2

    results = []
    for repo in discover_repos(src_root, args.repos):
        if not (repo / "construct.yaml").is_file():
            results.append({"construct": repo.name, "skipped": "no construct.yaml"})
            continue
        c7 = check_c7(repo / "identity" / "environment.md")
        results.append({
            "construct": repo.name,
            "c7": c7,
            "c7_pass": c7_pass(c7),
            "c8": check_c8(repo),
        })

    graded = [r for r in results if "c7_pass" in r]
    summary = {
        "rubric_sha256": rubric._sha256_hex((HERE / "construct-rubric.py").read_bytes()),
        "repos_graded": len(graded),
        "repos_skipped": len(results) - len(graded),
        "c7_grounded": sum(1 for r in graded if r["c7_pass"]),
        "c8_verified_chains": sum(1 for r in graded if r["c8"]["status"] == "verified"),
        "c8_broken_chains": [r["construct"] for r in graded if r["c8"]["status"] == "BROKEN"],
    }
    out = {"summary": summary, "results": results}
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        s = summary
        print(f"fleet-sweep: {s['c7_grounded']}/{s['repos_graded']} grounded (C7) · "
              f"{s['c8_verified_chains']} verified chains · broken: {s['c8_broken_chains'] or 'none'}")
        for r in graded:
            mark = "✓" if r["c7_pass"] else "✗"
            fails = "" if r["c7_pass"] else " [" + ", ".join(
                k for k, v in r["c7"].items()
                if k not in ("copied_sections",) and v is False) + "]"
            print(f"  {mark} {r['construct']}{fails}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
