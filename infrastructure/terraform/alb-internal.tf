# =============================================================================
# Internal ALB — Service-to-Service TLS (Cycle 037, Sprint 0A, Task 0A.3b)
# =============================================================================
#
# Internal Application Load Balancer for S2S communication between
# loa-freeside and loa-finn. Provides TLS termination for the JWKS endpoint
# and other internal API routes.
#
# Architecture:
#   finn → https://freeside.{env}.internal:443 → ALB → freeside ECS:3000
#
# Why internal ALB instead of direct Cloud Map:
#   - TLS termination: ACM certificates require ALB/NLB/CloudFront
#   - Cloud Map A records point to task IPs (no TLS)
#   - Internal ALB + ACM provides proper certificate validation
#   - finn does NOT skip certificate verification (Flatline SKP-004)
#
# @see SDD §4.3 S2S JWT Contract
# @see Sprint 0A, Task 0A.3b
# =============================================================================

# -----------------------------------------------------------------------------
# Route53 Private Hosted Zone for internal service discovery
# Used for ACM DNS validation and internal DNS resolution
# -----------------------------------------------------------------------------

resource "aws_route53_zone" "internal" {
  name    = "${var.environment}.internal"
  comment = "Private DNS zone for internal S2S communication"

  vpc {
    vpc_id = module.vpc.vpc_id
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-internal-zone"
    Purpose = "s2s-tls"
    Sprint  = "C37-0A"
  })
}

# -----------------------------------------------------------------------------
# ACM Certificate for internal domain
# DNS-validated via the private hosted zone
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "internal" {
  domain_name       = "freeside.${var.environment}.internal"
  validation_method = "DNS"

  subject_alternative_names = [
    "finn.${var.environment}.internal",
  ]

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-internal-cert"
    Purpose = "s2s-tls"
    Sprint  = "C37-0A"
  })
}

# DNS validation records in the private hosted zone
resource "aws_route53_record" "internal_acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.internal.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.internal.zone_id
}

resource "aws_acm_certificate_validation" "internal" {
  certificate_arn         = aws_acm_certificate.internal.arn
  validation_record_fqdns = [for record in aws_route53_record.internal_acm_validation : record.fqdn]

  timeouts {
    create = "30m"
  }
}

# -----------------------------------------------------------------------------
# Internal ALB Security Group
# Only allows inbound from ECS tasks (finn → ALB → freeside)
# -----------------------------------------------------------------------------

resource "aws_security_group" "alb_internal" {
  name_prefix = "${local.name_prefix}-alb-int-"
  vpc_id      = module.vpc.vpc_id
  description = "Security group for internal ALB — S2S TLS termination"

  # Inbound HTTPS from finn ECS tasks
  ingress {
    description     = "HTTPS from finn"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.finn.id]
  }

  # Inbound HTTPS from freeside ECS tasks (self-referential for health checks)
  ingress {
    description     = "HTTPS from freeside ECS tasks"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  # Outbound to freeside ECS tasks on port 3000
  egress {
    description     = "HTTP to freeside ECS tasks"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-alb-internal-sg"
    Purpose = "s2s-tls"
    Sprint  = "C37-0A"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Allow freeside ECS tasks to accept traffic from internal ALB
resource "aws_security_group_rule" "freeside_from_internal_alb" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.alb_internal.id
  description              = "Internal ALB to freeside ECS tasks"
}

# Update finn egress: route to internal ALB (port 443) instead of direct task (port 3000)
resource "aws_security_group_rule" "finn_to_internal_alb" {
  type                     = "egress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.finn.id
  source_security_group_id = aws_security_group.alb_internal.id
  description              = "loa-finn to internal ALB for JWKS (TLS)"
}

# -----------------------------------------------------------------------------
# Internal ALB
# -----------------------------------------------------------------------------

resource "aws_lb" "internal" {
  name               = "${local.name_prefix}-alb-int"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_internal.id]
  subnets            = module.vpc.private_subnets

  enable_deletion_protection = false # Set to true for production

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-alb-internal"
    Purpose = "s2s-tls"
    Sprint  = "C37-0A"
  })
}

# -----------------------------------------------------------------------------
# Target Group — routes to freeside ECS tasks
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "freeside_internal" {
  name        = "${local.name_prefix}-fs-int-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/.well-known/jwks.json"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Service = "Freeside"
    Purpose = "s2s-tls"
    Sprint  = "C37-0A"
  })
}

# -----------------------------------------------------------------------------
# HTTPS Listener — TLS termination with ACM certificate
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "internal_https" {
  load_balancer_arn = aws_lb.internal.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.internal.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.freeside_internal.arn
  }

  depends_on = [aws_acm_certificate_validation.internal]
}

# -----------------------------------------------------------------------------
# DNS Record — freeside.{env}.internal → internal ALB
# Replaces Cloud Map for TLS-secured S2S communication
# -----------------------------------------------------------------------------

resource "aws_route53_record" "freeside_internal" {
  zone_id = aws_route53_zone.internal.zone_id
  name    = "freeside.${var.environment}.internal"
  type    = "A"

  alias {
    name                   = aws_lb.internal.dns_name
    zone_id                = aws_lb.internal.zone_id
    evaluate_target_health = true
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "internal_alb_dns" {
  description = "Internal ALB DNS name"
  value       = aws_lb.internal.dns_name
}

output "freeside_internal_url" {
  description = "Internal HTTPS URL for loa-freeside (finn → freeside S2S)"
  value       = "https://freeside.${var.environment}.internal"
}

output "internal_zone_id" {
  description = "Private hosted zone ID for internal S2S DNS"
  value       = aws_route53_zone.internal.zone_id
}

output "freeside_internal_target_group_arn" {
  description = "Target group ARN for freeside internal ALB"
  value       = aws_lb_target_group.freeside_internal.arn
}
