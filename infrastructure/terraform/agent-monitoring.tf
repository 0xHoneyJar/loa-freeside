# =============================================================================
# Agent Gateway Monitoring Dashboard & Alarms
# Sprint 4, Task 4.2: CloudWatch dashboard + alarm infrastructure
#
# Metrics are emitted via EMF from packages/adapters/agent/agent-metrics.ts
# using the namespace "Arrakis/AgentGateway".
# =============================================================================

# -----------------------------------------------------------------------------
# CloudWatch Dashboard
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "agent_gateway" {
  dashboard_name = "${local.name_prefix}-agent-gateway"

  dashboard_body = jsonencode({
    widgets = [
      # Row 0: Header
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 1
        properties = {
          markdown = "# Agent Gateway - Operational Dashboard\n**Namespace:** `Arrakis/AgentGateway` | **Features:** baseline, ensemble, byok | **Emitter:** agent-metrics.ts (EMF)"
        }
      },

      # Row 1: Request Latency p99 by feature
      {
        type   = "metric"
        x      = 0
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Request Latency p99 by Feature"
          region = var.aws_region
          stat   = "p99"
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/AgentGateway", "RequestLatency", "feature", "baseline", { label = "baseline p99" }],
            [".", ".", ".", "ensemble", { label = "ensemble p99" }],
            [".", ".", ".", "byok", { label = "byok p99" }]
          ]
          annotations = {
            horizontal = [
              { value = 5000, label = "SLA 5s", color = "#d62728" }
            ]
          }
          yAxis = {
            left = { label = "ms", min = 0 }
          }
        }
      },

      # Row 1: Request Count by feature
      {
        type   = "metric"
        x      = 8
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Request Count by Feature"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "RequestCount", "feature", "baseline", { label = "baseline" }],
            [".", ".", ".", "ensemble", { label = "ensemble" }],
            [".", ".", ".", "byok", { label = "byok" }]
          ]
          yAxis = {
            left = { label = "count", min = 0 }
          }
        }
      },

      # Row 1: Error Rate (5xx / total * 100 via metric math)
      {
        type   = "metric"
        x      = 16
        y      = 1
        width  = 8
        height = 6
        properties = {
          title  = "Error Rate %"
          region = var.aws_region
          period = 60
          view   = "timeSeries"
          metrics = [
            [{ id = "errors", stat = "Sum", visible = false, expression = "" }, "Arrakis/AgentGateway", "Error5xxCount", "feature", "baseline"],
            [{ id = "errors_ensemble", stat = "Sum", visible = false, expression = "" }, ".", ".", ".", "ensemble"],
            [{ id = "errors_byok", stat = "Sum", visible = false, expression = "" }, ".", ".", ".", "byok"],
            [{ id = "total", stat = "Sum", visible = false, expression = "" }, ".", "RequestCount", ".", "baseline"],
            [{ id = "total_ensemble", stat = "Sum", visible = false, expression = "" }, ".", ".", ".", "ensemble"],
            [{ id = "total_byok", stat = "Sum", visible = false, expression = "" }, ".", ".", ".", "byok"],
            [{ id = "e1", expression = "IF(total > 0, errors / total * 100, 0)", label = "baseline %", stat = "Average" }],
            [{ id = "e2", expression = "IF(total_ensemble > 0, errors_ensemble / total_ensemble * 100, 0)", label = "ensemble %", stat = "Average" }],
            [{ id = "e3", expression = "IF(total_byok > 0, errors_byok / total_byok * 100, 0)", label = "byok %", stat = "Average" }]
          ]
          annotations = {
            horizontal = [
              { value = 5, label = "Alarm 5%", color = "#d62728" }
            ]
          }
          yAxis = {
            left = { label = "%", min = 0, max = 100 }
          }
        }
      },

      # Row 2: Rate Limit Hits by dimension
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Rate Limit Hits by Dimension"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "RateLimitHit", "dimension", "ip", { label = "IP" }],
            [".", ".", ".", "community", { label = "Community" }],
            [".", ".", ".", "user", { label = "User" }]
          ]
          yAxis = {
            left = { label = "count", min = 0 }
          }
        }
      },

      # Row 2: Circuit Breaker State by component
      {
        type   = "metric"
        x      = 8
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Circuit Breaker State by Component"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/AgentGateway", "CircuitBreakerState", "component", "loa-finn", { label = "loa-finn (0=closed, 2=open)" }],
            [".", ".", ".", "redis", { label = "redis" }],
            [".", ".", ".", "byok-kms", { label = "byok-kms" }]
          ]
          annotations = {
            horizontal = [
              { value = 2, label = "OPEN", color = "#d62728" },
              { value = 1, label = "HALF-OPEN", color = "#ff7f0e" }
            ]
          }
          yAxis = {
            left = { min = 0, max = 3 }
          }
        }
      },

      # Row 2: Redis Latency p99
      {
        type   = "metric"
        x      = 16
        y      = 7
        width  = 8
        height = 6
        properties = {
          title  = "Redis Latency p99"
          region = var.aws_region
          stat   = "p99"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "RedisLatency", "operation", "reserve", { label = "reserve p99" }],
            [".", ".", ".", "finalize", { label = "finalize p99" }],
            [".", ".", ".", "reap", { label = "reap p99" }]
          ]
          yAxis = {
            left = { label = "ms", min = 0 }
          }
        }
      },

      # Row 3: Budget - CommittedReportedDelta by accounting_mode
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "Budget: CommittedReportedDelta"
          region = var.aws_region
          stat   = "Average"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "CommittedReportedDelta", "accounting_mode", "standard", { label = "standard (micro-USD)" }],
            [".", ".", ".", "byok", { label = "byok (micro-USD)" }]
          ]
          yAxis = {
            left = { label = "micro-USD" }
          }
        }
      },

      # Row 3: Budget - ReservationAge
      {
        type   = "metric"
        x      = 8
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "Budget: ReservationAge"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "ReservationAge", { label = "Max Age (ms)" }]
          ]
          annotations = {
            horizontal = [
              { value = 300000, label = "Alarm 300s", color = "#d62728" }
            ]
          }
          yAxis = {
            left = { label = "ms", min = 0 }
          }
        }
      },

      # Row 3: Pool Claim Mismatch Rate
      {
        type   = "metric"
        x      = 16
        y      = 13
        width  = 8
        height = 6
        properties = {
          title  = "Pool Claim Mismatch / Reject"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "PoolClaimMismatch", { label = "Mismatch (warn)", color = "#ff7f0e" }],
            [".", "PoolClaimReject", { label = "Reject (block)", color = "#d62728" }]
          ]
          yAxis = {
            left = { label = "count", min = 0 }
          }
        }
      },

      # Row 4: Finalize Failures
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "Finalize Failures"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["Arrakis/AgentGateway", "FinalizeFailure", { label = "Failures", color = "#d62728" }]
          ]
          annotations = {
            horizontal = [
              { value = 1, label = "Alarm threshold", color = "#d62728" }
            ]
          }
          yAxis = {
            left = { label = "count", min = 0 }
          }
        }
      },

      # =====================================================================
      # Cycle-019 Capability Mesh Widgets (Sprint 4 — AC-4.13)
      # =====================================================================

      # Row 5: Header
      {
        type   = "text"
        x      = 0
        y      = 25
        width  = 24
        height = 1
        properties = {
          markdown = "## Capability Mesh — Per-Model Accounting & Observability\n**Cycle:** 019 | **Source:** Bridgebuilder Round 6"
        }
      },

      # Row 6: Per-Model Cost Distribution (stacked bar by model_id)
      {
        type   = "metric"
        x      = 0
        y      = 26
        width  = 8
        height = 6
        properties = {
          title  = "Per-Model Cost Distribution"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          view   = "bar"
          stacked = true
          metrics = [
            ["Arrakis/AgentGateway", "PerModelCost", "model_id", "cheap", { label = "cheap" }],
            [".", ".", ".", "fast-code", { label = "fast-code" }],
            [".", ".", ".", "reviewer", { label = "reviewer" }],
            [".", ".", ".", "reasoning", { label = "reasoning" }],
            [".", ".", ".", "architect", { label = "architect" }]
          ]
          yAxis = {
            left = { label = "micro-USD", min = 0 }
          }
        }
      },

      # Row 6: BYOK vs Platform Accounting Mode
      {
        type   = "metric"
        x      = 8
        y      = 26
        width  = 8
        height = 6
        properties = {
          title  = "BYOK vs Platform Accounting"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          view   = "pie"
          metrics = [
            ["Arrakis/AgentGateway", "PerModelCost", "accounting_mode", "PLATFORM_BUDGET", { label = "Platform Budget" }],
            [".", ".", ".", "BYOK_NO_BUDGET", { label = "BYOK (No Budget)" }]
          ]
        }
      },

      # Row 6: Ensemble Savings (reservation vs committed delta)
      {
        type   = "metric"
        x      = 16
        y      = 26
        width  = 8
        height = 6
        properties = {
          title  = "Ensemble Savings (Reservation Headroom)"
          region = var.aws_region
          stat   = "Average"
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/AgentGateway", "EnsembleSavings", { label = "savings (micro-USD)", color = "#2ca02c" }]
          ]
          annotations = {
            horizontal = [
              { value = 0, label = "Break-even", color = "#ff7f0e" }
            ]
          }
          yAxis = {
            left = { label = "micro-USD" }
          }
        }
      },

      # Row 7: Token Estimate Accuracy
      {
        type   = "metric"
        x      = 0
        y      = 32
        width  = 8
        height = 6
        properties = {
          title  = "Token Estimate Accuracy"
          region = var.aws_region
          stat   = "Average"
          period = 300
          view   = "timeSeries"
          metrics = [
            ["Arrakis/AgentGateway", "TokenEstimateDrift", { label = "Mean Error %", color = "#ff7f0e" }]
          ]
          annotations = {
            horizontal = [
              { value = 100, label = "Alarm 100%", color = "#d62728" },
              { value = 50, label = "Warning 50%", color = "#ff7f0e" }
            ]
          }
          yAxis = {
            left = { label = "%", min = 0 }
          }
        }
      },

      # Row 7: Lifecycle State Distribution
      {
        type   = "metric"
        x      = 8
        y      = 32
        width  = 8
        height = 6
        properties = {
          title  = "Lifecycle Final State"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          view   = "bar"
          metrics = [
            ["Arrakis/AgentGateway", "LifecycleFinalState", "final_state", "FINALIZED", { label = "Finalized", color = "#2ca02c" }],
            [".", ".", ".", "FAILED", { label = "Failed", color = "#d62728" }]
          ]
          yAxis = {
            left = { label = "count", min = 0 }
          }
        }
      },

      # Row 7: Fleet Circuit Breaker (Redis-backed, shared state)
      {
        type   = "metric"
        x      = 16
        y      = 32
        width  = 8
        height = 6
        properties = {
          title  = "Fleet Circuit Breaker (Redis)"
          region = var.aws_region
          stat   = "Maximum"
          period = 60
          view   = "timeSeries"
          metrics = [
            ["Arrakis/AgentGateway", "CircuitBreakerState", "component", "kms", { label = "KMS (fleet-wide)" }],
            [".", ".", ".", "loa-finn", { label = "loa-finn" }]
          ]
          annotations = {
            horizontal = [
              { value = 2, label = "OPEN", color = "#d62728" },
              { value = 1, label = "HALF-OPEN", color = "#ff7f0e" }
            ]
          }
          yAxis = {
            left = { min = 0, max = 3 }
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms
# -----------------------------------------------------------------------------

# 1. Error rate > 5% for 5 minutes (metric math: 5xx / total * 100)
resource "aws_cloudwatch_metric_alarm" "agent_error_rate_high" {
  alarm_name          = "${local.name_prefix}-agent-error-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  threshold           = 5
  alarm_description   = "Agent Gateway error rate > 5% for 5 minutes — investigate 5xx spike"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "errors"
    return_data = false

    metric {
      metric_name = "Error5xxCount"
      namespace   = "Arrakis/AgentGateway"
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id          = "total"
    return_data = false

    metric {
      metric_name = "RequestCount"
      namespace   = "Arrakis/AgentGateway"
      period      = 60
      stat        = "Sum"
    }
  }

  metric_query {
    id          = "error_rate"
    expression  = "IF(total > 0, errors / total * 100, 0)"
    label       = "Error Rate %"
    return_data = true
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "critical"
  })
}

# 2. Latency p99 > 5s for 5 minutes
resource "aws_cloudwatch_metric_alarm" "agent_latency_high" {
  alarm_name          = "${local.name_prefix}-agent-latency-p99-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "RequestLatency"
  namespace           = "Arrakis/AgentGateway"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 5000
  alarm_description   = "Agent Gateway p99 latency > 5s for 5 minutes — LLM provider or downstream degraded"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# 3. Circuit breaker open > 2 minutes
resource "aws_cloudwatch_metric_alarm" "agent_circuit_breaker_open" {
  alarm_name          = "${local.name_prefix}-agent-circuit-breaker-open"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "CircuitBreakerState"
  namespace           = "Arrakis/AgentGateway"
  period              = 60
  statistic           = "Maximum"
  threshold           = 2
  alarm_description   = "Agent Gateway circuit breaker OPEN for > 2 minutes — downstream component unavailable"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# 4. Budget threshold > 80%
resource "aws_cloudwatch_metric_alarm" "agent_budget_threshold" {
  alarm_name          = "${local.name_prefix}-agent-budget-threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CommittedReportedDelta"
  namespace           = "Arrakis/AgentGateway"
  period              = 300
  statistic           = "Maximum"
  threshold           = 80
  alarm_description   = "Agent Gateway budget delta > 80% threshold — committed spend diverging from reported, possible accounting drift"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# 5. Stale reservations > 300s (300,000 ms)
resource "aws_cloudwatch_metric_alarm" "agent_stale_reservations" {
  alarm_name          = "${local.name_prefix}-agent-stale-reservations"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ReservationAge"
  namespace           = "Arrakis/AgentGateway"
  period              = 300
  statistic           = "Maximum"
  threshold           = 300000
  alarm_description   = "Agent Gateway reservation age > 300s — reaper may be failing or streams are stuck"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# 6. Finalize failures > 0 for 10 minutes
resource "aws_cloudwatch_metric_alarm" "agent_finalize_failures" {
  alarm_name          = "${local.name_prefix}-agent-finalize-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 10
  metric_name         = "FinalizeFailure"
  namespace           = "Arrakis/AgentGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Agent Gateway finalize failures persisting for 10 minutes — budget may not be releasing reservations"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "critical"
  })
}

# 7. Token estimate drift > 100% for 15 minutes (AC-4.14)
resource "aws_cloudwatch_metric_alarm" "agent_token_estimate_drift" {
  alarm_name          = "${local.name_prefix}-agent-token-estimate-drift"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 15
  metric_name         = "TokenEstimateDrift"
  namespace           = "Arrakis/AgentGateway"
  period              = 60
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "Agent Gateway token estimate drift > 100% for 15 minutes — TokenEstimator chars-per-token ratio needs recalibration"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "high"
  })
}

# 8. Ensemble budget overrun (savings < 0) for any request (AC-4.14)
resource "aws_cloudwatch_metric_alarm" "agent_ensemble_budget_overrun" {
  alarm_name          = "${local.name_prefix}-agent-ensemble-budget-overrun"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EnsembleSavings"
  namespace           = "Arrakis/AgentGateway"
  period              = 60
  statistic           = "Minimum"
  threshold           = 0
  alarm_description   = "Agent Gateway ensemble savings < 0 — committed cost exceeded reservation, budget invariant violated"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.common_tags, {
    Service  = "AgentGateway"
    Severity = "critical"
  })
}
