# =============================================================================
# DNS Root — Auth Proxy Records
# =============================================================================
#
# Routes auth.0xhoneyjar.xyz to our AWS API Gateway auth proxy, which
# transparently forwards to Dynamic Labs (app.dynamic.xyz) with correct
# CORS headers on ALL responses — fixing the CSRF/SSO initialization issue.
#
# Previous: CNAME → alias.app.dynamicauth.com (Dynamic's broken CORS proxy)
# Current:  CNAME → API Gateway custom domain (our proxy, correct CORS)
#
# References:
#   - https://github.com/0xHoneyJar/mcv-interface/issues/7
#   - infrastructure/terraform/auth-proxy.tf (proxy definition)
#
# Rollback: Change records back to ["alias.app.dynamicauth.com"] and remove
#           the ACM validation record.
# =============================================================================

# Auth proxy — points to our API Gateway custom domain
# The target_domain_name is output by the auth-proxy.tf compute root.
# For the initial DNS root apply BEFORE the compute root creates the API Gateway,
# use a placeholder or apply compute root first.
#
# IMPORTANT: This is a cross-root reference. The API Gateway custom domain
# target must be copied from `terraform output auth_proxy_domain_target`
# in the compute root. We use a variable to avoid cross-state coupling.
resource "aws_route53_record" "auth_dynamic" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "auth.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  # When auth_proxy_domain_target is set, route to our API Gateway proxy.
  # Otherwise, fall back to Dynamic's default proxy (pre-migration state).
  records = [var.auth_proxy_domain_target != "" ? var.auth_proxy_domain_target : "alias.app.dynamicauth.com"]
}

# ACM certificate DNS validation for auth.0xhoneyjar.xyz
# The validation record name/value come from the ACM certificate in the
# compute root. After initial setup, these are stable and don't change.
# Only created when auth proxy is active (ACM cert needs DNS validation)
resource "aws_route53_record" "auth_acm_validation" {
  count   = var.auth_proxy_acm_validation_name != "" ? 1 : 0
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.auth_proxy_acm_validation_name
  type    = "CNAME"
  ttl     = 300
  records = [var.auth_proxy_acm_validation_value]
}

# Legacy Dynamic ACME challenge — keep until fully cutover, then remove
resource "aws_route53_record" "auth_dynamic_acme" {
  count   = var.auth_proxy_domain_target != "" ? 0 : 1
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_acme-challenge.auth.${var.domain}"
  type    = "TXT"
  ttl     = 300
  records = ["zWaEYtZC4NyMRWZ7t9SntGNA6wagem2nufIlwwPyYWI"]
}
