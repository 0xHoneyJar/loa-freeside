# =============================================================================
# DNS Root — Backend API Record (Feature-Gated)
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.7: dns/honeyjar-xyz-backend.tf
# =============================================================================

# Step 1: Find ALB by tag (aws_lbs supports tag filtering; aws_lb does not)
data "aws_lbs" "compute" {
  count = var.enable_production_api ? 1 : 0

  tags = {
    Name = "arrakis-${var.environment}-alb"
  }

  lifecycle {
    postcondition {
      condition     = length(self.arns) == 1
      error_message = "Expected exactly one ALB matching arrakis-${var.environment}-alb, got ${length(self.arns)}"
    }
  }
}

# Step 2: Read ALB details by ARN
data "aws_lb" "compute_alb" {
  count = var.enable_production_api ? 1 : 0
  arn   = one(data.aws_lbs.compute[0].arns)
}

# Step 3: Create alias record
resource "aws_route53_record" "api" {
  count = var.enable_production_api ? 1 : 0

  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  alias {
    name                   = data.aws_lb.compute_alb[0].dns_name
    zone_id                = data.aws_lb.compute_alb[0].zone_id
    evaluate_target_health = true
  }
}
