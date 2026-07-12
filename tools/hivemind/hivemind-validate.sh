#!/usr/bin/env bash
# hivemind-validate.sh — operator-level validator for the Hivemind Laboratory taxonomy.
# VENDORED from ~/.claude/laboratory/hivemind-validate.sh; the only change is the schema
# path (repo-relative, fresh-clone-safe; override with HIVEMIND_SCHEMA). Validates a
# `hivemind:` YAML block against the vendored canonical schema (@2bd219ad).
#
#   hivemind-validate.sh <file>     validate the hivemind: block in a file
#   hivemind-validate.sh --stdin    read a hivemind: block from stdin
#   hivemind-validate.sh <file> --strict   exit non-zero on any violation (default: warn, exit 0)
#
# Conformance: every dim present must be a known dimension (additionalProperties:false)
# with a value in its enum; the core triad (artifact_type × workstream × priority) SHOULD
# be present. A file with NO hivemind: block is not a Lab artifact → exits 0 silently.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="${HIVEMIND_SCHEMA:-$SCRIPT_DIR/hivemind-labels.v1.0.json}"
STRICT=0; SRC=""; FILE=""
for a in "$@"; do case "$a" in --strict) STRICT=1;; --stdin) SRC=stdin;; *) FILE="$a";; esac; done
[ -f "$SCHEMA" ] || { echo "hivemind-validate: schema missing ($SCHEMA)" >&2; exit 0; }

# Read stdin BEFORE the python heredoc (the heredoc occupies python's stdin, so
# sys.stdin.read() inside it sees EOF — canon --stdin bug). Pass via env instead.
HIVEMIND_CONTENT=""
[ "$SRC" = stdin ] && HIVEMIND_CONTENT="$(cat)"
export HIVEMIND_CONTENT

python3 - "$SCHEMA" "$STRICT" "$SRC" "$FILE" <<'PY'
import sys, re, json, os
schema_path, strict, src, file = sys.argv[1], sys.argv[2]=="1", sys.argv[3], sys.argv[4]
schema = json.load(open(schema_path))
props = schema.get("properties", {})
enums = {k: set(v["enum"]) for k, v in props.items() if v.get("enum")}
KNOWN = set(props.keys())
CORE = ["artifact_type", "workstream", "priority"]

text = os.environ.get("HIVEMIND_CONTENT", "") if src == "stdin" else (open(file, encoding="utf-8", errors="replace").read() if file else "")
# extract a `hivemind:` mapping — the key line then its indented children (YAML block)
m = re.search(r'(?m)^(\s*)hivemind:\s*$', text)
if not m:
    sys.exit(0)  # not a Lab artifact — silent pass
base = len(m.group(1))
lines = text[m.end():].splitlines()
block = {}
for ln in lines:
    if not ln.strip():
        continue
    indent = len(ln) - len(ln.lstrip())
    if indent <= base:
        break  # dedent → block ended
    km = re.match(r'\s*([A-Za-z0-9_]+):\s*(.*)$', ln)
    if km:
        block[km.group(1)] = km.group(2).strip().strip('"').strip("'")

if not block:
    sys.exit(0)

findings = []
for k, v in block.items():
    if k not in KNOWN:
        findings.append(f"unknown dimension '{k}' (additionalProperties:false)")
    elif k in enums and v and v not in enums[k]:
        findings.append(f"'{k}: {v}' not in enum → {sorted(enums[k])}")
missing = [c for c in CORE if c not in block]
if missing:
    findings.append(f"missing core triad dim(s): {missing}")

if not findings:
    sys.exit(0)  # conformant
Y, X = "\033[33m", "\033[0m"
sys.stderr.write(f"{Y}⚠ hivemind taxonomy drift{X} in {file or 'stdin'}:\n")
for f in findings:
    sys.stderr.write(f"    · {f}\n")
sys.exit(1 if strict else 0)
PY
