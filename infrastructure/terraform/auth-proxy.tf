# =============================================================================
# Dynamic Auth Proxy — AWS API Gateway HTTP API
# =============================================================================
#
# Replaces Dynamic Labs' custom domain proxy (alias.app.dynamicauth.com) with
# an AWS-managed transparent proxy that correctly sets CORS headers on ALL
# responses — including 404s and other error codes.
#
# Root cause: Dynamic's proxy only sets CORS headers on 2xx responses. When
# the SDK hits /csrf (404), the browser sees a CORS violation instead of a
# clean 404, breaking SDK initialization.
#
# Architecture:
#   auth.0xhoneyjar.xyz → API Gateway HTTP API → app.dynamic.xyz
#
# References:
#   - https://github.com/0xHoneyJar/mcv-interface/issues/7
#   - infrastructure/terraform/dns/honeyjar-xyz-auth.tf (DNS records)
#
# Rollback: Change DNS record back to alias.app.dynamicauth.com
# =============================================================================

# -----------------------------------------------------------------------------
# API Gateway HTTP API
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "auth_proxy" {
  name          = "${local.name_prefix}-auth-proxy"
  protocol_type = "HTTP"
  description   = "Transparent proxy to Dynamic Labs API with CORS on all responses"

  cors_configuration {
    # Explicit allowlist required — credentialed CORS forbids wildcard origins.
    # Add new subdomains here as apps are deployed.
    allow_origins = [
      "https://0xhoneyjar.xyz",
      "https://moneycomb.0xhoneyjar.xyz",
      "https://honey.0xhoneyjar.xyz",
      "https://hub.0xhoneyjar.xyz",
      "https://midi.0xhoneyjar.xyz",
      "https://mibera.0xhoneyjar.xyz",
      "https://cubquests.0xhoneyjar.xyz",
      "https://henlo.0xhoneyjar.xyz",
      "https://auction.0xhoneyjar.xyz",
      "https://app.0xhoneyjar.xyz",
      "https://staging.0xhoneyjar.xyz",
      "https://setandforgetti.0xhoneyjar.xyz",
    ]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    # x-dyn-* headers are sent by Dynamic Labs ClientSDK (alpha.28 verified;
    # other versions may send subsets). When the SDK sends a header NOT in
    # this allowlist, APIGW's preflight returns 204 but STRIPS ALL CORS
    # headers — browser then reports "No ACAO" even though the underlying
    # config allows the origin. Each new SDK header must be added here.
    #
    # Dynamic's upstream API permissively reflects whatever headers the SDK
    # requests in Access-Control-Request-Headers; APIGW HTTP API can't do
    # that with strict allowlist + credentials=true (CORS spec forbids `*`).
    allow_headers     = [
      "Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin",
      # SDK alpha.28 + WalletKit/4.42.0 verified header set (DevTools 2026-05-27)
      "X-Dyn-Version", "X-Dyn-Api-Version", "X-Dyn-Request-Id",
      "X-Dyn-Device-Fingerprint", "X-Dyn-Is-Global-Wallet-Popup",
      "X-Dyn-Session-Public-Key",
      # Speculative — observed in older SDK probes, kept for safety
      "X-Dyn-Client-Platform", "X-Dyn-Client-Platform-Version",
      "X-Dyn-Environment-Id", "X-Dyn-Csrf-Token",
    ]
    expose_headers    = ["Content-Length", "Content-Type"]
    allow_credentials = true
    max_age           = 86400
  }

  tags = merge(local.common_tags, {
    Service = "AuthProxy"
    Purpose = "Dynamic Labs CORS proxy"
  })
}

# -----------------------------------------------------------------------------
# HTTP Proxy Integration → Dynamic Labs
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "dynamic_proxy" {
  api_id             = aws_apigatewayv2_api.auth_proxy.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  # app.dynamicauth.com is Dynamic's API-specific host.
  # For /{proxy+} routes, API Gateway substitutes the {proxy} path variable.
  integration_uri    = "https://app.dynamicauth.com/{proxy}"

  request_parameters = {
    "overwrite:header.host" = "app.dynamicauth.com"
  }
}

# Separate integration for root path (no {proxy} variable available)
resource "aws_apigatewayv2_integration" "dynamic_proxy_root" {
  api_id             = aws_apigatewayv2_api.auth_proxy.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = "https://app.dynamicauth.com"

  request_parameters = {
    "overwrite:header.host" = "app.dynamicauth.com"
  }
}

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
# Method-specific (NOT `ANY`) so OPTIONS preflight requests are handled by
# API Gateway's native CORS layer instead of being forwarded to the upstream.
#
# Why this matters: `ANY /{proxy+}` matches OPTIONS, which causes APIGW to
# forward preflight requests to app.dynamicauth.com (CF-fronted). If
# Cloudflare rate-limits the proxy's outbound traffic, OPTIONS returns 429
# with CORS headers — but CORS spec requires 2xx for preflight to succeed,
# so the browser fails with "No 'Access-Control-Allow-Origin' header is
# present" even though the header is actually there.
#
# Solution: don't catch OPTIONS in any route. APIGW auto-handles OPTIONS
# preflight via the `cors_configuration` on the API resource when no route
# matches. This terminates preflights locally with a clean 204, never
# contacting the upstream, immune to upstream rate limits.
locals {
  proxy_route_methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]
}

resource "aws_apigatewayv2_route" "proxy_route" {
  for_each  = toset(local.proxy_route_methods)
  api_id    = aws_apigatewayv2_api.auth_proxy.id
  route_key = "${each.value} /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.dynamic_proxy.id}"
}

resource "aws_apigatewayv2_route" "root_route" {
  for_each  = toset(local.proxy_route_methods)
  api_id    = aws_apigatewayv2_api.auth_proxy.id
  route_key = "${each.value} /"
  target    = "integrations/${aws_apigatewayv2_integration.dynamic_proxy_root.id}"
}

# -----------------------------------------------------------------------------
# Stage (auto-deploy)
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.auth_proxy.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.auth_proxy.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      integrationStatus = "$context.integrationStatus"
      path           = "$context.path"
    })
  }

  tags = merge(local.common_tags, {
    Service = "AuthProxy"
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Logs
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "auth_proxy" {
  name              = "/aws/apigateway/${local.name_prefix}-auth-proxy"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Service = "AuthProxy"
  })
}

# -----------------------------------------------------------------------------
# ACM Certificate for auth.0xhoneyjar.xyz
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "auth_proxy" {
  domain_name       = "auth.0xhoneyjar.xyz"
  validation_method = "DNS"

  tags = merge(local.common_tags, {
    Service = "AuthProxy"
    Purpose = "TLS for auth proxy custom domain"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Custom Domain
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_domain_name" "auth" {
  domain_name = "auth.0xhoneyjar.xyz"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.auth_proxy.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = merge(local.common_tags, {
    Service = "AuthProxy"
  })

  depends_on = [aws_acm_certificate_validation.auth_proxy]
}

# Certificate validation (DNS record created in the DNS root)
resource "aws_acm_certificate_validation" "auth_proxy" {
  certificate_arn = aws_acm_certificate.auth_proxy.arn

  # Validation happens via DNS record — see dns/honeyjar-xyz-auth.tf
  # The validation record must exist before this resource completes.
  # For initial apply, you may need to apply the DNS root first.
}

# -----------------------------------------------------------------------------
# API Mapping
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_api_mapping" "auth" {
  api_id      = aws_apigatewayv2_api.auth_proxy.id
  domain_name = aws_apigatewayv2_domain_name.auth.id
  stage       = aws_apigatewayv2_stage.default.name
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "auth_proxy_api_endpoint" {
  description = "API Gateway endpoint URL (for testing before DNS cutover)"
  value       = aws_apigatewayv2_api.auth_proxy.api_endpoint
}

output "auth_proxy_domain_target" {
  description = "Target domain name for DNS CNAME/alias record"
  value       = aws_apigatewayv2_domain_name.auth.domain_name_configuration[0].target_domain_name
}
