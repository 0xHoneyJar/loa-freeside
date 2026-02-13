# @arrakis/loa-finn-contract

Contract artifacts defining the integration boundary between arrakis and loa-finn.

## What This Is

This package is the **single source of truth** for the arrakis-to-loa-finn API contract:

- **JSON Schema** (`schema/loa-finn-contract.json`) — JWT claims, invoke response, usage report, stream event schemas
- **Test Vectors** (`vectors/loa-finn-test-vectors.json`) — decoded payload templates for E2E scenarios (signed at runtime with ephemeral keys)
- **Tier Pool Mapping** — which access levels map to which model pools
- **Compatibility Matrix** (`compatibility.json`) — which arrakis/loa-finn versions work together

The `CONTRACT_VERSION` (from `package.json`) is used as the `pool_mapping_version` JWT claim value, ensuring both systems agree on the pool mapping in use.

## Versioning Policy

This package follows **semver**:

| Change Type | Version Bump | Example |
|-------------|-------------|---------|
| Breaking schema change (field removed, type changed) | **Major** | Remove `cost_usd` from invoke response |
| Additive change (new optional field, new vector) | **Minor** | Add `ensemble_partial_failure` to response |
| Bug fix (typo in description, test vector correction) | **Patch** | Fix test vector expected token count |

## How to Update

### Adding a New Test Vector

1. Add the vector object to `vectors/loa-finn-test-vectors.json`
2. Include `name`, `description`, `request` (with `jwt_claims` and `body`), `response`, and `usage_report_payload`
3. If the vector needs body-based routing in the stub, update `matchVector()` in `loa-finn-e2e-stub.ts`
4. Bump the patch version in `package.json`

### Changing the Schema

1. Edit `schema/loa-finn-contract.json`
2. If adding an optional field: bump **minor** version
3. If removing/changing a field: bump **major** version
4. Update `compatibility.json` with a new entry
5. Coordinate with loa-finn to ensure both sides agree

### Updating Compatibility Matrix

Add a new entry to `compatibility.json` whenever the contract version changes:

```json
{
  "arrakis": ">=<commit-sha-or-version-tag>",
  "loa_finn": ">=<commit-sha-or-version-tag>",
  "contract": "X.Y.Z",
  "notes": "Description of what changed"
}
```

Use content-addressable references (full 40-character commit SHA or semver tag), not PR numbers.

## Programmatic Access

```typescript
import {
  CONTRACT_VERSION,
  CONTRACT_SCHEMA,
  TEST_VECTORS,
  getVector,
  getCompatibility,
} from './contracts/src/index.js';

// Get contract version (used as pool_mapping_version)
console.log(CONTRACT_VERSION); // "1.0.0"

// Get a specific test vector
const vector = getVector('invoke_free_tier');

// Get compatibility matrix
const compat = getCompatibility();
console.log(compat.contract_version);
```

## File Structure

```
contracts/
  compatibility.json          # Cross-system version compatibility matrix
  package.json                # Version = CONTRACT_VERSION
  README.md                   # This file
  schema/
    loa-finn-contract.json    # JSON Schema definitions
  src/
    index.ts                  # Typed exports
  vectors/
    loa-finn-test-vectors.json  # E2E test payloads
```
