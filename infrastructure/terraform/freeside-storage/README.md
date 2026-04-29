# freeside-storage — Terraform Module

Sovereign asset surface (`assets.0xhoneyjar.xyz`) — a parallel CloudFront
distribution against the existing `thj-assets` bucket.

## What this module ships

- 1 ACM certificate in `us-east-1` for the alias FQDN
- 1 CloudFront Origin Access Control (OAC) for S3 access
- 1 CloudFront distribution with two cache behaviors:
  - `*.webp` → S3 direct (mirrors legacy `d163aeqznbc6js` fast path)
  - default → S3 direct (NO image optimizer; explicit by design — see ADR-006)
- 1 data source reference to the existing `thj-assets` bucket

## What this module does NOT ship

- A new S3 bucket (descoped per [Amendment 3](../../../decisions/006-image-optimizer-stays-on-d163.md))
- IAM roles (cross-account assumed-role pattern not needed; see `iam.tf`)
- Route53 alias record (manual per [`freeside-dns-state-untracked`](../../../README.md); see `route53.tf`)
- The image optimizer chain (stays at `d163aeqznbc6js.cloudfront.net`; see ADR-006)

## Usage

```hcl
provider "aws" {
  region = "us-west-2"  # where thj-assets lives
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"  # ACM cert + CloudFront require this
}

module "freeside_storage" {
  source = "./freeside-storage"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  alias_fqdn            = "assets.0xhoneyjar.xyz"
  backing_bucket_name   = "thj-assets"
  backing_bucket_region = "us-west-2"
  hosted_zone_name      = "0xhoneyjar.xyz"

  common_tags = {
    Service   = "freeside-storage"
    ManagedBy = "terraform"
    Cycle     = "mature-freeside-operator-and-cutover"
  }
}
```

## Apply procedure

The apply is a 3-step dance because ACM cert validation is manual (per the
project DNS doctrine):

```bash
# Step 1: create the cert + OAC. Distribution attach will fail until cert is ISSUED.
terraform apply -target=aws_acm_certificate.alias \
                -target=aws_cloudfront_origin_access_control.s3_oac

# Step 2: pull validation records, create them manually in Route53 console
terraform output -json acm_validation_records

# ...wait for cert status to move from PENDING_VALIDATION to ISSUED (5-30min)...

# Step 3: full apply — creates the distribution
terraform apply

# Step 4: pull the alias target + create A/AAAA alias records in Route53 console
terraform output cloudfront_distribution_domain

# Step 5: update thj-assets bucket policy (additive) to grant OAC
terraform output oac_id
terraform output cloudfront_distribution_arn
# operator updates bucket policy in AWS console — see runbook
```

## Outputs

| Output | Purpose |
|--------|---------|
| `cloudfront_distribution_id` | Reference for invalidations + monitoring |
| `cloudfront_distribution_arn` | Required for the bucket policy OAC grant |
| `cloudfront_distribution_domain` | Target for the Route53 alias record |
| `cloudfront_hosted_zone_id` | Required for the Route53 alias record |
| `alias_fqdn` | Custom domain (echoed for downstream automation) |
| `acm_certificate_arn` | Reference for cert lifecycle |
| `acm_validation_records` | List of `{name, type, value}` to create in Route53 |
| `backing_bucket_name` | Existing bucket the distribution reads from |
| `backing_bucket_arn` | For bucket-policy authoring |
| `oac_id` | Required for the bucket policy OAC grant |

## Acceptance (T11 sprint task)

After apply + manual DNS + bucket-policy grant:

```bash
curl -I https://assets.0xhoneyjar.xyz/Mibera/generated/0.webp
# expect: HTTP/2 200; content-type: image/webp
```

The legacy distribution `d163aeqznbc6js` is UNTOUCHED. Both distributions read
from the same `thj-assets` bucket; the new one bypasses the optimizer chain
for the `*.webp` direct + default-direct cache behaviors.

## References

- [SDD §0.1 Amendment 3 (Image Plane Reality)](../../../../bonfire/grimoires/loa/sdd.md)
- [ADR-006 — Image Optimizer Stays on d163](../../../decisions/006-image-optimizer-stays-on-d163.md)
- Project memory: `freeside-dns-state-untracked`, `freeside-secret-management-direction`
