# Consumer-Driven Contract: loa-freeside → loa-hounfour

This directory contains the consumer-driven contract between **loa-freeside** (consumer) and **loa-hounfour** (provider).

## What the Contract Covers

1. **Entrypoint Availability** — Every symbol that freeside imports from hounfour is listed in `contract.json`. If hounfour removes or renames an export, the contract breaks.

2. **Behavioral Vectors** — The `conformance_vectors` section references `spec/vectors/*.json`, which contain golden test inputs and expected outputs. The `vectors-bundle.sha256` file pins the hash of these vectors.

## How to Run Validation

### In freeside CI (consumer)

```bash
# Entrypoint checks only (fast)
node spec/contracts/validate.mjs

# Entrypoints + conformance vectors (full)
node spec/contracts/validate.mjs --run-vectors
```

### In hounfour CI (provider)

Install freeside as a devDependency to get the contract, then validate:

```bash
# In hounfour repo
pnpm add -D loa-freeside@latest
node node_modules/loa-freeside/spec/contracts/validate.mjs
```

This runs entrypoint availability checks against the candidate hounfour version. If any symbol is missing, the validation fails — signaling that freeside would break.

## How to Update the Contract

When freeside **adds or removes** hounfour imports:

1. Update `contract.json` entrypoints to match the actual imports in `themes/sietch/src/packages/core/protocol/index.ts`
2. Run `node spec/contracts/validate.mjs` to verify
3. The `contract-spec.test.ts` test will catch barrel drift in CI

When freeside **updates conformance vectors** (`spec/vectors/*.json`):

1. Recompute the bundle hash:
   ```bash
   find spec/vectors/ -name '*.json' -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
   ```
2. Update `vectors-bundle.sha256` and `contract.json` → `conformance_vectors.bundle_hash`

## What Happens When the Contract Breaks

**Freeside must update, not hounfour must revert.** The contract expresses freeside's expectations. If hounfour evolves its API, freeside updates its imports and contract to match. The contract prevents *accidental* breakage, not *intentional* API evolution.

If hounfour CI detects a contract failure:
1. Check if the symbol was intentionally removed/renamed
2. If intentional: coordinate with freeside to update the contract
3. If accidental: fix in hounfour before release

## Files

| File | Purpose |
|------|---------|
| `contract.json` | Pinned entrypoints + conformance vector metadata |
| `vectors-bundle.sha256` | SHA-256 hash of `spec/vectors/*.json` bundle |
| `validate.mjs` | ESM validation script (entrypoints + optional vectors) |
| `README.md` | This file |
