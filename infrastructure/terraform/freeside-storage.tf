# =============================================================================
# freeside-storage — production root consumer
# =============================================================================
#
# Per Sprint 1 of mature-freeside-operator-and-cutover cycle (T11). The module
# itself lives at ./freeside-storage/ and was authored in T4. This file is the
# production callsite that materializes the resources.
#
# Reality (per SDD §0.1 Amendment 3): no new bucket. The new CloudFront
# distribution at assets.0xhoneyjar.xyz reads from the existing thj-assets
# bucket in us-west-2. Image optimizer chain stays at d163aeqznbc6js
# (unchanged) per ADR-006.
#
# Apply procedure (3 targeted phases — ACM validation is manual per
# project memory `freeside-dns-state-untracked`):
#
#   # Phase 1: cert + OAC
#   terraform apply \
#     -target=module.freeside_storage.aws_acm_certificate.alias \
#     -target=module.freeside_storage.aws_cloudfront_origin_access_control.s3_oac
#
#   # Phase 2: pull validation records, create CNAMEs by hand in Route53
#   terraform output -json freeside_storage_acm_validation_records
#   #   ...operator creates each CNAME in Route53 console...
#   #   ...wait for ACM cert status to move PENDING_VALIDATION → ISSUED (5-30m)...
#
#   # Phase 3: full apply (creates the distribution)
#   terraform apply -target=module.freeside_storage
#
#   # Phase 4: pull alias target + create A/AAAA in Route53 console
#   terraform output -json freeside_storage_cloudfront_distribution_domain
#
#   # Phase 5: update thj-assets bucket policy in AWS console (additive OAC grant)
#   terraform output -json freeside_storage_oac_grant
# =============================================================================

# us_west_2 provider alias — backing bucket thj-assets lives here
provider "aws" {
  alias  = "us_west_2"
  region = "us-west-2"

  default_tags {
    tags = {
      Service   = "freeside-storage"
      ManagedBy = "terraform"
      Cycle     = "mature-freeside-operator-and-cutover"
    }
  }
}

module "freeside_storage" {
  source = "./freeside-storage"

  providers = {
    aws           = aws.us_west_2 # default → bucket region (us-west-2)
    aws.us_east_1 = aws           # us_east_1 alias → production root default (already us-east-1)
  }

  alias_fqdn            = "assets.0xhoneyjar.xyz"
  backing_bucket_name   = "thj-assets"
  backing_bucket_region = "us-west-2"
  hosted_zone_name      = "0xhoneyjar.xyz"

  # Reuse the existing wildcard cert *.0xhoneyjar.xyz (already ISSUED, used by ALBs).
  # Avoids the CAA-cache issue we hit during T11 — the wildcard cert was issued
  # before the *.0xhoneyjar.xyz → vercel-dns.com wildcard CNAME was added, so
  # ACM has no stale CAA failure for it.
  existing_acm_certificate_arn = "arn:aws:acm:us-east-1:891376933289:certificate/c96a10f5-ec24-4fed-9779-0a858eeff522"

  common_tags = {
    Service   = "freeside-storage"
    ManagedBy = "terraform"
    Cycle     = "mature-freeside-operator-and-cutover"
  }
}

# Surface the module outputs at the root so `terraform output` works at the
# canonical apply location.

output "freeside_storage_cloudfront_distribution_id" {
  description = "ID of the new CloudFront distribution"
  value       = module.freeside_storage.cloudfront_distribution_id
}

output "freeside_storage_cloudfront_distribution_arn" {
  description = "ARN — required for the bucket-policy OAC grant"
  value       = module.freeside_storage.cloudfront_distribution_arn
}

output "freeside_storage_cloudfront_distribution_domain" {
  description = "Auto-generated CF domain — target for the Route53 alias record"
  value       = module.freeside_storage.cloudfront_distribution_domain
}

output "freeside_storage_cloudfront_hosted_zone_id" {
  description = "CloudFront's hosted zone ID — required for the Route53 alias record"
  value       = module.freeside_storage.cloudfront_hosted_zone_id
}

output "freeside_storage_acm_certificate_arn" {
  description = "ACM cert ARN (us-east-1)"
  value       = module.freeside_storage.acm_certificate_arn
}

output "freeside_storage_acm_validation_records" {
  description = "DNS validation records to create MANUALLY in Route53"
  value       = module.freeside_storage.acm_validation_records
}

output "freeside_storage_oac_grant" {
  description = "Inputs for the manual bucket-policy update (OAC grant)"
  value = {
    distribution_arn = module.freeside_storage.cloudfront_distribution_arn
    oac_id           = module.freeside_storage.oac_id
    bucket_arn       = module.freeside_storage.backing_bucket_arn
  }
}
