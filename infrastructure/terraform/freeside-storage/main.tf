# =============================================================================
# freeside-storage — Main (locals + computed values)
# =============================================================================
#
# Per SDD §0.1 Amendment 3 (2026-04-29) the original framing of "new bucket +
# bulk sync + dual-write" is descoped. The reality:
#
#   - thj-assets (us-west-2) is the existing sovereign asset store
#   - The legacy distribution `d163aeqznbc6js` is an image-OPTIMIZER chain
#     with a *.webp direct-S3 fast path
#   - Phase 0 publishes a STABLE URL CONTRACT surface for external builders
#     by adding a parallel distribution against the SAME backing bucket
#   - Apps using direct *.webp paths get the URL contract immediately
#   - Apps using optimizer paths (`/images/{proxy+}`, `/_next/image*`) keep
#     using d163aeqznbc6js (optimizer migration deferred per ADR-006)
#
# This module ships:
#   - 1 data source for the existing thj-assets bucket
#   - 1 ACM certificate in us-east-1 for assets.0xhoneyjar.xyz
#   - 1 CloudFront Origin Access Control (OAC) for the new distribution
#   - 1 CloudFront distribution with alias + 2 cache behaviors
#   - 1 S3 bucket policy statement attached as an OAC grant (additive, in
#     bucket-policy.tf — bucket policy is an OUT-OF-MODULE concern; see README)
#
# What this module does NOT ship:
#   - A new bucket (descoped per Amendment 3)
#   - IAM roles (cross-account assumed-role pattern is no longer needed; see
#     iam.tf for placeholder)
#   - Route53 record (manual per project-memory `freeside-dns-state-untracked`;
#     see route53.tf)
# =============================================================================

locals {
  origin_id_s3   = "${var.name_prefix}-s3-${var.backing_bucket_name}"
  s3_origin_host = "${var.backing_bucket_name}.s3.${var.backing_bucket_region}.amazonaws.com"

  # Either reuse an existing cert (e.g. *.0xhoneyjar.xyz wildcard) or use the
  # one this module provisions. The conditional resource below honors both
  # paths.
  acm_certificate_arn = var.existing_acm_certificate_arn != null ? var.existing_acm_certificate_arn : try(aws_acm_certificate.alias[0].arn, "")

  # AWS-managed `Managed-CORS-With-Preflight` response headers policy.
  # Adds `Access-Control-Allow-Origin: *` (and friends) to all responses
  # so browser canvas consumers (img crossOrigin="anonymous" + drawImage)
  # don't taint the canvas. Same policy that the legacy d163 distribution
  # attaches to its *.webp cache behavior. Global ID, valid in every AWS
  # account; documented at:
  # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html#managed-response-headers-policies-cors
  cors_response_headers_policy_id = "5cc3b908-e619-4b99-88e5-2cf7f45965bd"

  tags = merge(var.common_tags, {
    Module = var.name_prefix
  })
}

# -----------------------------------------------------------------------------
# Existing bucket — read-only data source
# -----------------------------------------------------------------------------
# We do NOT manage thj-assets in this module. It pre-dates this cycle and is
# managed elsewhere. We only reference it as a CloudFront origin.

data "aws_s3_bucket" "backing" {
  bucket = var.backing_bucket_name
}

# -----------------------------------------------------------------------------
# ACM certificate for the alias FQDN (us-east-1 — CloudFront requirement)
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "alias" {
  count    = var.existing_acm_certificate_arn != null ? 0 : 1
  provider = aws.us_east_1

  domain_name       = var.alias_fqdn
  validation_method = "DNS"

  # Note: `create_before_destroy` is moot in the production callsite (which
  # always supplies `existing_acm_certificate_arn`, setting count=0 here).
  # It applies only to the standalone-cert path (no existing cert), which
  # is currently unused in production. Kept for module reusability.
  # (Bridgebuilder F017)
  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-${var.alias_fqdn}"
  })
}

# DNS validation records are CREATED MANUALLY in Route53 per project-memory
# `freeside-dns-state-untracked` (production DNS untracked by terraform).
# The operator runs:
#   terraform output acm_validation_records
# then creates each CNAME in the Route53 console. After creation, the cert
# moves from PENDING_VALIDATION to ISSUED.
#
# A future cycle SHOULD import the validation records into terraform and
# replace this manual step with `aws_acm_certificate_validation`.

# -----------------------------------------------------------------------------
# CloudFront Origin Access Control (modern; replaces OAI)
# -----------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "s3_oac" {
  name                              = "${var.name_prefix}-s3-oac"
  description                       = "OAC for ${var.alias_fqdn} → ${var.backing_bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# CloudFront distribution
# -----------------------------------------------------------------------------
# Two cache behaviors:
#   1. *.webp → S3 origin (direct; mirrors legacy d163aeqznbc6js fast path)
#   2. default → S3 origin (direct; NO optimizer chain — see ADR-006)

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "freeside-storage — sovereign asset surface (${var.alias_fqdn})"
  default_root_object = ""
  price_class         = var.price_class
  http_version        = "http2and3"

  aliases = concat([var.alias_fqdn], var.additional_aliases)

  origin {
    origin_id                = local.origin_id_s3
    domain_name              = local.s3_origin_host
    origin_access_control_id = aws_cloudfront_origin_access_control.s3_oac.id
    # OAC requires no S3OriginConfig block (modern). OAC handles auth via SigV4.
  }

  # ---- Cache behavior #1: *.webp → S3 direct (fast path mirror) ----
  # NOTE (Bridgebuilder F012): The `forwarded_values` block below is the
  # legacy CloudFront cache-key API. AWS recommends migrating to managed
  # cache policies (e.g. `cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"`
  # for Managed-CachingOptimized). Migration deferred to a future cycle —
  # the change is mutually exclusive with `forwarded_values` + `min_ttl`/
  # `default_ttl`/`max_ttl` blocks, so it's a coordinated swap, not a
  # one-line tweak. Current behavior matches Managed-CachingOptimized
  # semantics (no query in cache key, no cookies forwarded).
  ordered_cache_behavior {
    path_pattern           = "*.webp"
    target_origin_id       = local.origin_id_s3
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    min_ttl     = var.min_ttl
    default_ttl = var.default_ttl
    max_ttl     = var.max_ttl

    # CORS — required because consumer apps (mibera-honeyroad/dimensions
    # `useTraitCanvas` hook) load images with `crossOrigin="anonymous"` to
    # paint onto a `<canvas>` via `drawImage`. Without `Access-Control-Allow-
    # Origin` headers the canvas is tainted and drawImage throws. Mirrors
    # the legacy d163 distribution's *.webp behavior config.
    response_headers_policy_id = local.cors_response_headers_policy_id

    forwarded_values {
      query_string = false
      headers      = []
      cookies {
        forward = "none"
      }
    }
  }

  # ---- Default cache behavior: S3 direct (no optimizer; explicit by design) ----
  default_cache_behavior {
    target_origin_id       = local.origin_id_s3
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    min_ttl     = var.min_ttl
    default_ttl = var.default_ttl
    max_ttl     = var.max_ttl

    # CORS — see comment on the *.webp cache behavior. Default behavior
    # serves PNGs (e.g. `/reveal_phase8/images/{hash}.png` for codex
    # consumers). Same policy applies; canvas-painting consumers need it.
    response_headers_policy_id = local.cors_response_headers_policy_id

    # Cutover B (Amendment A2) — manifest resolver. Conditional via
    # var.metadata_resolver_enabled. The function rewrites
    #   /{collection}/{tokenId}  →  /{collection}/metadata/v/{ver}/{tokenId}.json
    # for requests that match. Non-matching paths pass through unmodified,
    # so existing assets.* traffic is untouched.
    dynamic "function_association" {
      for_each = var.metadata_resolver_enabled ? [1] : []
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.metadata_resolver[0].arn
      }
    }

    forwarded_values {
      query_string = false
      headers      = []
      cookies {
        forward = "none"
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-${var.alias_fqdn}"
  })

  # ACM cert must be ISSUED before the distribution can attach it.
  # Since we DNS-validate manually (see comment above), the operator must
  # confirm cert status before applying this resource. Use `-target` for
  # phased apply if needed:
  #   terraform apply -target=aws_acm_certificate.alias
  #   # ...manually create CNAME, wait for ISSUED...
  #   terraform apply
}

# -----------------------------------------------------------------------------
# Bucket policy grant for OAC
# -----------------------------------------------------------------------------
# The new distribution's OAC must be ALLOWED in the bucket policy. The bucket
# is shared (legacy distribution + new distribution both read from it), so the
# policy is ADDITIVE — we do NOT overwrite the existing bucket policy.
#
# This is intentionally OUT OF SCOPE for this module skeleton. The bucket
# policy update is a manual step documented in T11's runbook:
#
#   1. terraform apply (creates OAC + distribution)
#   2. terraform output cloudfront_distribution_arn
#   3. operator updates bucket policy in AWS console (additive Statement)
#   4. terraform output is the source of truth for the ARN to grant
#
# Future cycle SHOULD codify the bucket policy in this module via
# `aws_s3_bucket_policy` with a data source for the existing policy and a
# merge step. Risky (overwrites) without careful testing — deferred.

# =============================================================================
# Cutover B (Amendment A2) — Manifest-Pattern Metadata Resolver
# =============================================================================
# Provisions:
#   - 1 CloudFront KeyValueStore                  (collection→version pointers)
#   - 1 CloudFront Function (cloudfront-js-2.0)   (rewrites stable URLs)
#   - N initial KV entries from `metadata_resolver_initial_pointers`
#   - Function attached to the distribution's default cache behavior above
#
# The function code lives at ./metadata-resolver.js. It runs on
# viewer-request, reads the KV pointer for the requested collection, and
# rewrites /{collection}/{tokenId} → /{collection}/metadata/v/{ver}/{id}.json.
#
# Routing semantics: the same distribution serves both assets.0xhoneyjar.xyz
# and metadata.0xhoneyjar.xyz. The function's path regex is the implicit
# selector — assets.* requests rarely match /^/[a-z][a-z0-9-]*\/\d+$/, while
# metadata.* requests by-design hit that shape. Non-matching requests pass
# through unchanged.
# =============================================================================

resource "aws_cloudfront_key_value_store" "metadata_pointers" {
  count    = var.metadata_resolver_enabled ? 1 : 0
  provider = aws.us_east_1

  name    = "${var.name_prefix}-metadata-pointers"
  comment = "Collection→version pointer store consumed by the metadata-resolver CloudFront Function (Cutover B)"
}

resource "aws_cloudfrontkeyvaluestore_key" "initial_pointers" {
  for_each = var.metadata_resolver_enabled ? var.metadata_resolver_initial_pointers : {}
  provider = aws.us_east_1

  key_value_store_arn = aws_cloudfront_key_value_store.metadata_pointers[0].arn
  key                 = each.key
  value               = each.value
}

resource "aws_cloudfront_function" "metadata_resolver" {
  count    = var.metadata_resolver_enabled ? 1 : 0
  provider = aws.us_east_1

  name    = "${var.name_prefix}-metadata-resolver"
  runtime = "cloudfront-js-2.0"
  comment = "Resolve /{collection}/{tokenId} to versioned metadata path via KeyValueStore (Cutover B, Amendment A2)"
  publish = true

  key_value_store_associations = [aws_cloudfront_key_value_store.metadata_pointers[0].arn]

  code = file("${path.module}/metadata-resolver.js")
}
