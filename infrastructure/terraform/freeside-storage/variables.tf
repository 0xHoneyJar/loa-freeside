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

# -----------------------------------------------------------------------------
# Cutover B (2026-04-30, Amendment A2) — manifest-pattern metadata resolver
# -----------------------------------------------------------------------------
# When `metadata_resolver_enabled = true`, the module:
#   - adds `additional_aliases` to the distribution (e.g. metadata.0xhoneyjar.xyz)
#   - provisions a CloudFront KeyValueStore for collection→version pointers
#   - provisions a CloudFront Function (viewer-request) that rewrites
#     /{collection}/{tokenId} → /{collection}/metadata/v/{version}/{tokenId}.json
#   - attaches the function to the default cache behavior
#
# When false (default), the distribution is unchanged from Cutover A.
#
# Reversibility (corrected per Bridgebuilder F4):
#   - Setting enabled=false plans to DESTROY the KV store and pointer keys
#     (count/for_each are gated on this flag).
#   - KV pointer values are NOT preserved across a disable→enable round-trip.
#   - For non-destructive disable in production: set `additional_aliases = []`
#     and remove the function_association externally. That detaches
#     metadata.{org} traffic without destroying KV state.
#   - True KV-state preservation across toggle requires decoupling the KV
#     store resource from this flag (always provision KV, gate only the
#     function_association + aliases). Deferred to follow-on cycle.
# -----------------------------------------------------------------------------

variable "metadata_resolver_enabled" {
  description = "When true, provision the manifest-pattern metadata resolver (CF Function + KeyValueStore + alias extension). See migrate-mibera-sovereignty-2026-04-30.plan.yaml Amendment A2."
  type        = bool
  default     = false
}

variable "additional_aliases" {
  description = <<-EOT
    Additional FQDNs to attach as CloudFront aliases (e.g.
    ['metadata.0xhoneyjar.xyz']). Empty list = single alias mode (Cutover A).

    Prerequisites per alias (Bridgebuilder F5 — operator must verify before apply):
      1. Cert coverage — `existing_acm_certificate_arn` must cover the FQDN.
         A `*.0xhoneyjar.xyz` wildcard cert covers depth-2 (e.g. `metadata.*`)
         but NOT depth-3 (`a.b.0xhoneyjar.xyz` would need a separate cert).
      2. Route53 record — manual A/AAAA ALIAS pointing at the distribution
         domain (per project memory `freeside-dns-state-untracked`; Route53
         is currently outside terraform). Pull target via:
            terraform output cloudfront_distribution_domain
         Then create the alias record in the Route53 console.
      3. CloudFront rejects aliases not covered by the cert AT APPLY TIME, so
         a missed cert match fails fast. Route53 omission = NXDOMAIN at the
         FQDN, distribution itself is unaffected (alias is registered, just
         unreachable).
  EOT
  type        = list(string)
  default     = []
}

variable "metadata_resolver_initial_pointers" {
  description = "Initial entries to seed the KeyValueStore at creation time. Map of `{collection}:current_version` → version string. Example: { \"mibera:current_version\" = \"2026-04-30\" }. After bootstrap, ops updates pointers via `aws cloudfront-keyvaluestore put-key`."
  type        = map(string)
  default     = {}
}
