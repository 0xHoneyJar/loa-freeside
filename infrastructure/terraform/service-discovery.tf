# =============================================================================
# Service Discovery — Cloud Map Configuration
# Cycle 036: Launch Readiness — Sprint 1, Task 1.2
# =============================================================================
#
# Cloud Map private DNS namespace exists in pgbouncer.tf as:
#   aws_service_discovery_private_dns_namespace.main[0]
#   → "${local.name_prefix}.local"
#
# Registered services:
#   pgbouncer  → pgbouncer.tf
#   nats       → nats.tf (service_registries commented out due to ECS permission issue)
#   gateway    → gateway.tf
#   tempo      → tracing.tf
#   finn       → ecs-finn.tf
#   freeside   → this file (new)
#
# Day 1 Validation Spike (Flatline SKP-002):
#   1. Deploy Cloud Map namespace to staging
#   2. Register dummy ECS service, confirm nslookup resolves from inside task
#   3. Validate VPC DNS: enableDnsHostnames=true, enableDnsSupport=true
#   4. Confirm no conflicting private hosted zone for arrakis-{env}.local
#   5. Fallback: ALB internal listener if Cloud Map fails (2-hour time-box)
#
# VPC DNS Requirements (must be true for Cloud Map):
#   - enableDnsHostnames = true
#   - enableDnsSupport = true
# These are set in vpc.tf via the VPC module.

# -----------------------------------------------------------------------------
# freeside (loa-freeside API) Cloud Map Service
# Enables finn → freeside discovery via DNS
# -----------------------------------------------------------------------------

resource "aws_service_discovery_service" "freeside" {
  name = "freeside"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main[0].id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = merge(local.common_tags, {
    Service = "API"
    Sprint  = "C36-1"
  })
}

# -----------------------------------------------------------------------------
# Internal ALB Target Group for loa-finn (fallback path)
# No listener attached — available if Cloud Map fails during Day 1 spike
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "finn_internal" {
  name        = "${local.name_prefix}-finn-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Service = "Finn"
    Sprint  = "C36-1"
    Purpose = "internal-fallback"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "freeside_service_discovery_dns" {
  description = "Cloud Map DNS name for loa-freeside"
  value       = var.enable_service_discovery ? "freeside.${aws_service_discovery_private_dns_namespace.main[0].name}" : ""
}

output "finn_internal_target_group_arn" {
  description = "Internal ALB target group ARN for loa-finn (fallback)"
  value       = aws_lb_target_group.finn_internal.arn
}
