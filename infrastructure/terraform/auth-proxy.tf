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
    ]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    allow_headers     = ["Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin"]
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
  # HTTP API appends incoming path/query automatically — no {proxy} placeholder needed.
  integration_uri    = "https://app.dynamic.xyz"

  # Forward all headers including cookies for SSO
  request_parameters = {
    "overwrite:header.host" = "app.dynamic.xyz"
  }
}

# -----------------------------------------------------------------------------
# Catch-all Route
# -----------------------------------------------------------------------------

resource "aws_apigatewayv2_route" "proxy_route" {
  api_id    = aws_apigatewayv2_api.auth_proxy.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.dynamic_proxy.id}"
}

# Root path route (for /api/v0 direct hits)
resource "aws_apigatewayv2_route" "root_route" {
  api_id    = aws_apigatewayv2_api.auth_proxy.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.dynamic_proxy.id}"
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
