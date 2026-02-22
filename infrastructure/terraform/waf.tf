# =============================================================================
# AWS WAF — Webhook Rate Limiting + DoS Protection (Cycle 036, Task 3.7)
# =============================================================================
#
# Layer 1 (of 3) rate limiting for /api/crypto/webhook:
#   Layer 1: WAF IP-based rate limiting (this file)
#   Layer 2: Application-level per-payment_id throttle (Redis-backed middleware)
#   Layer 3: DB idempotency (SELECT ... FOR UPDATE + mint guard)
#
# NOTE: WAF rate-based rules use a 5-minute evaluation window.
# To achieve N requests/min, set limit = N * 5.
#
# @see SDD §3.2 Webhook Security
# @see Sprint 3, Task 3.7

# -----------------------------------------------------------------------------
# WAF WebACL
# -----------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "main" {
  name        = "${local.name_prefix}-waf"
  description = "WAF for ${local.name_prefix} ALB — webhook DoS protection"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # -------------------------------------------------------------------------
  # Rule 1: Webhook IP rate limit — 100 requests/min per source IP
  # WAF uses 5-min window → limit = 500 (100/min * 5min)
  # -------------------------------------------------------------------------
  rule {
    name     = "webhook-ip-rate-limit"
    priority = 1

    action {
      block {
        custom_response {
          response_code = 429
          custom_response_body_key = "rate-limited"

          response_header {
            name  = "Retry-After"
            value = "60"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit              = 500
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/crypto/webhook"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-webhook-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # -------------------------------------------------------------------------
  # Rule 2: Global request rate limit — 2000 requests/min per IP
  # WAF uses 5-min window → limit = 10000 (2000/min * 5min)
  # -------------------------------------------------------------------------
  rule {
    name     = "global-ip-rate-limit"
    priority = 2

    action {
      block {
        custom_response {
          response_code = 429
          custom_response_body_key = "rate-limited"

          response_header {
            name  = "Retry-After"
            value = "60"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit              = 10000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-global-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Custom response body for rate limiting
  custom_response_body {
    key          = "rate-limited"
    content      = "{\"error\":\"Too many requests\",\"retryAfter\":60}"
    content_type = "APPLICATION_JSON"
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = merge(local.common_tags, {
    Service = "waf"
    Sprint  = "C36-3"
  })
}

# -----------------------------------------------------------------------------
# Associate WAF with ALB
# -----------------------------------------------------------------------------

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# -----------------------------------------------------------------------------
# CloudWatch Logging (sampled requests — blocked only)
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name_prefix}"
  retention_in_days = 30

  tags = merge(local.common_tags, {
    Service = "waf"
  })
}

# WAF requires a resource policy granting waf.amazonaws.com write access
resource "aws_cloudwatch_log_resource_policy" "waf" {
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        }
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.waf.arn}:*"
        Condition = {
          ArnLike = {
            "aws:SourceArn" = aws_wafv2_web_acl.main.arn
          }
        }
      }
    ]
  })
  policy_name = "${local.name_prefix}-waf-logs"
}

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.main.arn

  logging_filter {
    default_behavior = "DROP"

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"

      condition {
        action_condition {
          action = "BLOCK"
        }
      }
    }
  }

  depends_on = [aws_cloudwatch_log_resource_policy.waf]
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "waf_web_acl_arn" {
  description = "ARN of the WAF WebACL"
  value       = aws_wafv2_web_acl.main.arn
}
