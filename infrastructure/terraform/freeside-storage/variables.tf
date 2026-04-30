# =============================================================================
# freeside-storage — Input Variables
# =============================================================================
#
# Per SDD §0.1 Amendment 3 (2026-04-29): NO new bucket. The module provisions a
# parallel CloudFront distribution + alias + ACM cert against the existing
# `thj-assets` bucket. The optimizer chain stays at d163aeqznbc6js.cloudfront.net
# (see decisions/006-image-optimizer-stays-on-d163.md).
# =============================================================================

variable "name_prefix" {
  description = "Prefix for resource names (e.g. 'freeside-storage')"
  type        = string
  default     = "freeside-storage"
}

variable "backing_bucket_name" {
  description = "Existing S3 bucket the new distribution reads from. Per SDD §0.4 image plane reality, this is `thj-assets`."
  type        = string
  default     = "thj-assets"
}

variable "backing_bucket_region" {
  description = "Region of the backing S3 bucket. Used to construct the regional endpoint for the CloudFront origin."
  type        = string
  default     = "us-west-2"
}

variable "alias_fqdn" {
  description = "Custom domain for the new distribution (per SDD §0 L5)"
  type        = string
  default     = "assets.0xhoneyjar.xyz"
}

variable "existing_acm_certificate_arn" {
  description = "Optional ARN of an existing ACM certificate (us-east-1) that covers `alias_fqdn`. If supplied, the module reuses this cert instead of provisioning a new one. Useful when a wildcard cert already exists for the parent zone (e.g. `*.0xhoneyjar.xyz`) — and avoids CAA-cache issues on freshly-issued certs."
  type        = string
  default     = null
}

variable "hosted_zone_name" {
  description = "Route53 hosted zone where the alias record lives. RESERVED for the future DNS-import cycle that takes ownership of `route53.tf` (currently commented out per project memory `freeside-dns-state-untracked`). Not consumed by any active code today; kept so the future cycle can wire it without re-introducing the variable. (Bridgebuilder F019)"
  type        = string
  default     = "0xhoneyjar.xyz"
}

# `tenant_prefixes` removed per Bridgebuilder F018 — the prior version of this
# variable was documented as "reference only, not enforced at the CloudFront
# layer", which created confusion. Tenant-prefix taxonomy lives in the URL
# contract schema (`freeside-storage/packages/protocol/url-contract.schema.json`)
# and the public doc at `loa-freeside/docs/asset-url-contract.md`. If a future
# cycle wires CloudFront-layer tenant enforcement (path patterns, distinct
# behaviors), the variable comes back with a real consumer.

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 = US/CA/EU (lowest cost; sufficient for sovereign asset surface)."
  type        = string
  default     = "PriceClass_100"
}

variable "min_ttl" {
  description = "Minimum TTL for cache behaviors (seconds)"
  type        = number
  default     = 0
}

variable "default_ttl" {
  description = "Default TTL for cache behaviors (seconds)"
  type        = number
  default     = 86400 # 24h
}

variable "max_ttl" {
  description = "Maximum TTL for cache behaviors (seconds)"
  type        = number
  default     = 31536000 # 1y
}

variable "common_tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Service   = "freeside-storage"
    ManagedBy = "terraform"
    Cycle     = "mature-freeside-operator-and-cutover"
  }
}
