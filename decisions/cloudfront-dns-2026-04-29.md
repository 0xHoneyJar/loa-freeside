# DNS records created during T11 (mature-freeside-operator-and-cutover Sprint 1)

**Date**: 2026-04-29
**Cycle**: `mature-freeside-operator-and-cutover` (Sprint 1, T11 + T11.5)
**Authors**: opus-4-7-1m + zksoju (operator approval via `/loa` "🚀 t11 apply now")
**Hosted zone**: `0xhoneyjar.xyz` (`Z01393483Y40WF3N1H76`)

This file logs the manual Route53 changes made during T11. Per project memory
`freeside-dns-state-untracked`, production DNS is intentionally NOT
terraform-managed; this log is the audit trail.

## Records added

### 1. CAA at `assets.0xhoneyjar.xyz` (CREATED)

```
Name: assets.0xhoneyjar.xyz
Type: CAA
TTL:  300
Values:
  0 issue "amazon.com"
  0 issuewild "amazon.com"
  0 iodef "mailto:security@0xhoneyjar.xyz"
```

**Why**: The `*.0xhoneyjar.xyz` wildcard CNAME points to `cname.vercel-dns.com`,
and per RFC 8659 ACM follows CNAME chains for CAA lookups. Vercel's CAA records
do NOT include amazon, so ACM validation initially failed with `CAA_ERROR`.
Adding an explicit CAA record at `assets.0xhoneyjar.xyz` (a) authorizes amazon
for that name and (b) breaks the wildcard match (since the name now has explicit
records, per RFC 4592), severing the Vercel-CNAME chain entirely.

**Change ID**: `/change/C0892690A5G34U7LNG1`

### 2. A + AAAA aliases at `assets.0xhoneyjar.xyz` (CREATED)

```
Name:         assets.0xhoneyjar.xyz
Type:         A (alias) + AAAA (alias)
Alias target: dpi55hct91flc.cloudfront.net
Alias zone:   Z2FDTNDATAQYW2 (CloudFront's global hosted zone)
EvaluateTargetHealth: false
```

**Why**: Routes `assets.0xhoneyjar.xyz` to the new CloudFront distribution
`EX3XFQSXORXM5` provisioned by `module.freeside_storage`. The
`EvaluateTargetHealth: false` is correct for CloudFront aliases (CloudFront
does not expose an alias-evaluable health check).

**Change ID**: `/change/C05321931L2KOMJTT44SQ`

## Records temporarily added then deleted

### Validation CNAME(s) for failed ACM cert(s)

During T11 we attempted to provision a fresh ACM cert for
`assets.0xhoneyjar.xyz`. Both attempts failed with `CAA_ERROR` despite the
fix above (likely AWS-internal DNS cache stickiness for the prior failure).
The validation CNAMEs were created and then cleaned up:

```
Name:  _fb387d3b14cc933792c1316895c6e88a.assets.0xhoneyjar.xyz
Type:  CNAME
Value: _f5918a887c1852e2023c0da5122e5b91.jkddzztszm.acm-validations.aws.

Lifecycle: created 20:29 UTC, deleted 20:32 UTC, recreated 20:33 UTC, finally deleted 20:44 UTC
```

The decision shifted to **reuse the existing `*.0xhoneyjar.xyz` wildcard ACM
cert** (`arn:aws:acm:us-east-1:891376933289:certificate/c96a10f5-…`) — already
ISSUED and in use by the production + staging ALBs. The wildcard cert covers
`assets.0xhoneyjar.xyz` as a depth-2 subdomain match. The module gained an
`existing_acm_certificate_arn` variable to support this reuse pattern.

## Records NOT touched

- `*.0xhoneyjar.xyz` wildcard CNAME → `cname.vercel-dns.com` — unchanged. The
  explicit CAA + alias at `assets.0xhoneyjar.xyz` overrides the wildcard for
  that one name; everything else still uses Vercel.
- Apex `0xhoneyjar.xyz` CAA records — unchanged (already authorize amazon +
  letsencrypt).
- `auth.0xhoneyjar.xyz`, `api.0xhoneyjar.xyz`, `mibera.0xhoneyjar.xyz`,
  `apdao.0xhoneyjar.xyz`, `rektdrop.0xhoneyjar.xyz`, `score-api.0xhoneyjar.xyz` —
  unchanged.
- Legacy CloudFront distribution `d163aeqznbc6js.cloudfront.net` — unchanged
  per ADR-006.

## Verification

```bash
# DNS resolution
dig +short assets.0xhoneyjar.xyz @8.8.8.8
# → 4× CloudFront IPs (99.84.215.*)

# HTTP probe — known-real key from thj-assets
curl -I https://assets.0xhoneyjar.xyz/Mibera/generated/0.webp
# → HTTP/2 200; content-type: image/webp; content-length: 684060

# Parity with legacy
curl -I https://d163aeqznbc6js.cloudfront.net/Mibera/generated/0.webp
# → HTTP/2 200; content-type: image/webp; content-length: 684060 (identical bytes)
```

Both distributions back from the same `thj-assets` bucket; identical content.

## Future cycles

A future cycle SHOULD:
1. Import the manual records (CAA + A/AAAA at `assets.0xhoneyjar.xyz`) into
   terraform state so they're tracked.
2. Uncomment the `aws_route53_record` blocks in
   `infrastructure/terraform/freeside-storage/route53.tf` and validate they
   match the imported state.
3. Reconcile the wider DNS state-drift situation (5 adds + 3 ALB flips per
   `freeside-dns-state-untracked` memory).

This is its own cycle — not Sprint 1 scope.
