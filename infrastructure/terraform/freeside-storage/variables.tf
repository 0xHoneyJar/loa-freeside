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

variable "hosted_zone_name" {
  description = "Route53 hosted zone where the alias record lives. Used in route53.tf — currently commented out per project memory `freeside-dns-state-untracked`; manual record creation is documented in decisions/cloudfront-dns-2026-04-29.md."
  type        = string
  default     = "0xhoneyjar.xyz"
}

variable "tenant_prefixes" {
  description = "S3 key prefixes that map to tenants. Documented for reference; not enforced at the CloudFront layer (path-based tenancy is a doc/contract concern, not a CDN concern)."
  type        = list(string)
  default     = ["Mibera", "Purupuru", "sprawl"]
}

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
