---
paths:
  - "*.sh"
  - "*.bats"
origin: enacted
version: 2
enacted_by: cycle-051
---

# Shell File Creation Safety

Bash heredocs silently corrupt source files containing `${...}` template literals.

| Method | Shell Expansion | When to Use |
|--------|-----------------|-------------|
| **Write tool** | None | Source files (.tsx, .jsx, .ts, .js, etc.) - PREFERRED |
| `<<'EOF'` (quoted) | None | Shell content with literal `${...}` |
| `<< EOF` (unquoted) | Yes | Shell scripts needing variable expansion only |

**Rule**: For source files, ALWAYS use Write tool. If heredoc required, ALWAYS quote the delimiter.

**Protocol**: `.claude/protocols/safe-file-creation.md`

# Bash Strict Mode Safety

When using `set -euo pipefail` (or `set -u` alone), these patterns prevent common failures:

## Empty Array Expansion

`${array[@]}` under `set -u` is an unbound variable error when the array is empty (bash <4.4). Always use the expansion guard:

```bash
# WRONG — fails under set -u when array is empty (bash <4.4)
printf '%s\n' "${MY_ARRAY[@]}"

# RIGHT — expands to nothing when array is empty
printf '%s\n' ${MY_ARRAY[@]+"${MY_ARRAY[@]}"}
```

## Array vs String Initialization

Don't declare `local var=()` if you use the variable as a string later. Bash arrays and strings are different types wearing the same syntax.

```bash
# WRONG — entries is an array but used as string
local entries=()
entries="some text"
[[ -n "$entries" ]]  # unbound under set -u when empty

# RIGHT — initialize as what you use it as
local entries=""
```

## JSON Construction Safety

Use `jq --arg` for strings and `--argjson` for JSON values. Validate before `--argjson`:

```bash
# WRONG — empty string is not valid JSON
jq -n --argjson content "$content" '{c: $content}'

# RIGHT — validate or default to null
if [[ -z "$content" ]] || ! echo "$content" | jq empty 2>/dev/null; then
    content="null"
fi
jq -n --argjson content "$content" '{c: $content}'
```

## Arithmetic with `set -e`

`(( var++ ))` exits with status 1 when `var=0` (evaluates to falsy). Use `var=$((var + 1))` instead.

```bash
# WRONG — exits script when count=0
(( count++ ))

# RIGHT — always succeeds
count=$((count + 1))
```
