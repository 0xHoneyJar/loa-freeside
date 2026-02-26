# Key Rotation Runbook

> Operational procedure for JWKS key rotation in the Arrakis staging/production environment.
> This document extracts knowledge encoded in `rotate-staging-keys.sh`, `revoke-staging-key.sh`,
> and Bridgebuilder review findings (B-1, Sprint 371) into a living operational document.

## Overview

The JWKS (JSON Web Key Set) system uses ES256 keys with unique `kid` (Key ID) fields.
Key rotation follows the Google Certificate Transparency overlap verification pattern:
new and old keys coexist during a transition window to prevent service disruption.

**Services in the chain:** freeside (JWKS publisher) -> finn (JWT validator) -> dixie (JWT validator)

---

## 1. Normal Rotation Procedure

**Estimated time:** ~20 minutes | **Risk:** Low (zero-downtime)

### Step 1: Generate New Key Pair (~1 min)
```bash
openssl ecparam -name prime256v1 -genkey -noout -out new-staging-key.pem
openssl ec -in new-staging-key.pem -pubout -out new-staging-key-pub.pem
```
**Failure mode:** OpenSSL not installed -> install via package manager.

### Step 2: Compute Key ID (~30 sec)
```bash
# kid = first 8 chars of SHA-256 of the public key DER
kid=$(openssl ec -pubin -in new-staging-key-pub.pem -outform DER 2>/dev/null | sha256sum | cut -c1-8)
echo "New kid: $kid"
```
**Failure mode:** kid collision (astronomically unlikely) -> regenerate key pair.

### Step 3: Upload New Key to Secrets Manager (~1 min)
```bash
aws secretsmanager put-secret-value \
  --secret-id arrakis-staging/jwks-private-key-new \
  --secret-string "$(cat new-staging-key.pem)"
```
**Failure mode:** IAM permissions error -> verify role has `secretsmanager:PutSecretValue`.

### Step 4: Deploy Freeside with Dual Keys (~5 min)
```bash
./scripts/rotate-staging-keys.sh --stage deploy-dual
```
This deploys freeside with both old and new keys in the JWKS endpoint. The `kid` field
differentiates them. Existing JWTs (signed with old key) remain valid.

**Failure mode:** Deploy fails -> rollback via `--stage rollback`. Old key still active.

### Step 5: Verify Dual-Key JWKS (~1 min)
```bash
curl -sf https://staging.api.arrakis.community/.well-known/jwks.json | jq '.keys | length'
# Expected: 2
curl -sf https://staging.api.arrakis.community/.well-known/jwks.json | jq '.keys[].kid'
# Should show both old and new kid values
```
**Failure mode:** Only 1 key visible -> check deploy logs, verify both keys in Secrets Manager.

### Step 6: Wait for JWKS Cache TTL (~15 min)
```bash
# JWKS cache TTL is 15 minutes across all services (finn, dixie)
# During this window, services may still have only the old key cached
echo "Waiting 15 minutes for JWKS cache propagation..."
sleep 900
```
**Why 15 minutes?** finn and dixie cache the JWKS response. The cache TTL is configured
at 15 minutes. Proceeding before cache expiry risks JWT validation failures for tokens
signed with the new key.

**Failure mode:** N/A (this is a wait step).

### Step 7: Switch Primary Key (~2 min)
```bash
./scripts/rotate-staging-keys.sh --stage switch-primary
```
This updates the signing key to the new key. New JWTs are now signed with the new kid.
Old key remains in JWKS for validation of in-flight requests.

**Failure mode:** Deploy fails -> both keys still valid, retry deploy.

### Step 8: Remove Old Key (After Confirmation) (~2 min)
```bash
# Only after confirming all services validate new-kid JWTs:
./scripts/staging-smoke.sh --test-key new-staging-key.pem

# If smoke test passes:
./scripts/rotate-staging-keys.sh --stage remove-old
```
**Failure mode:** Smoke test fails -> keep old key, investigate JWT validation errors.

---

## 2. Emergency Revocation Procedure

**Target time:** <5 minutes | **Risk:** Medium (may cause brief service disruption)

Use this when a key is known or suspected to be compromised.

### Step 1: Identify Compromised Key (~30 sec)
```bash
# Check which kid is currently signing
curl -sf https://staging.api.arrakis.community/.well-known/jwks.json | jq '.keys[].kid'
```

### Step 2: Revoke Compromised Key (~1 min)
```bash
./scripts/revoke-staging-key.sh --service freeside --kid <compromised-kid>
```
This immediately removes the compromised key from JWKS and triggers a deploy.
**WARNING:** Any in-flight JWTs signed with this key will fail validation.

**Failure mode:** Deploy fails -> manually update Secrets Manager and force deploy.

### Step 3: Generate Replacement Key (~1 min)
```bash
openssl ecparam -name prime256v1 -genkey -noout -out emergency-key.pem
openssl ec -in emergency-key.pem -pubout -out emergency-key-pub.pem
```

### Step 4: Deploy Replacement (~2 min)
```bash
./scripts/rotate-staging-keys.sh --emergency --key emergency-key.pem
```

### Step 5: Verify (~30 sec)
```bash
./scripts/staging-smoke.sh --test-key emergency-key.pem --retries 3
```

---

## 3. Verification Checklist

After any rotation (normal or emergency):

- [ ] JWKS endpoint returns expected number of keys
- [ ] Each key has a unique `kid` field
- [ ] Each key has `alg: "ES256"`
- [ ] Smoke test Phase 2 (JWKS) passes
- [ ] Smoke test Phase 3 (JWT round-trip) passes
- [ ] finn logs show successful JWT validation with new kid
- [ ] dixie logs show successful JWT validation with new kid
- [ ] No `JWT_VALIDATION_FAILED` entries in CloudWatch (check metric filter alarm)

---

## 4. When to Use `--wait-stable`

The `--wait-stable` flag in deploy scripts waits for ECS service stability (all tasks
running and healthy) before returning. Use it when:

| Scenario | Flag | Why |
|----------|------|-----|
| Normal rotation Step 4 | `--wait-stable` | Need dual keys visible before proceeding |
| Normal rotation Step 7 | Not needed | Old key still valid, no rush |
| Emergency revocation | Not needed | Speed > stability during emergency |
| Post-deploy smoke test | `--wait-stable` | Need all services healthy before testing |

---

## 5. Multi-Service Cascade

When rotating keys, services need restart/cache-clear in this order:

1. **freeside** — publishes JWKS (must be first)
2. **finn** — validates JWTs from freeside, queries dixie (deploy after JWKS propagation)
3. **dixie** — validates JWTs from finn (deploy after finn)

The `staging-deploy-all.sh` script handles this ordering automatically.
For manual operations, always deploy in this order.

**Cache invalidation timing:**
- freeside: Immediate (JWKS is dynamically served)
- finn: 15-minute JWKS cache TTL
- dixie: 15-minute JWKS cache TTL

---

## 6. Related Scripts

| Script | Purpose |
|--------|---------|
| `scripts/rotate-staging-keys.sh` | Automated rotation with stages |
| `scripts/revoke-staging-key.sh` | Emergency key revocation (<5 min) |
| `scripts/staging-smoke.sh` | Post-rotation verification |
| `scripts/staging-deploy-all.sh` | Cross-repo deploy orchestration |
| `scripts/sign-test-jwt.mjs` | Test JWT signing for verification |
