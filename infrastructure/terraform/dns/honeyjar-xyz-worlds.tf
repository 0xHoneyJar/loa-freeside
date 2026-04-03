# =============================================================================
# DNS Root — World Subdomain Records
# Issue: https://github.com/0xHoneyJar/loa-freeside/issues/159
# =============================================================================
# World subdomains need explicit A records pointing to the compute ALB.
# Without these, the wildcard CNAME (*.0xhoneyjar.xyz → Vercel) takes effect
# and traffic never reaches the ALB. Per RFC 4592, specific records win.
# =============================================================================

# Reuse the same ALB data source from honeyjar-xyz-backend.tf
# (gated behind enable_production_api which is already set for production)

locals {
  # All worlds hosted on the compute ALB
  world_subdomains = var.enable_production_api ? toset([
    "mibera",
    "apdao",
    "rektdrop",
    "score-api",
  ]) : toset([])
}

resource "aws_route53_record" "world" {
  for_each = local.world_subdomains

  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "A"

  alias {
    name                   = data.aws_lb.compute_alb[0].dns_name
    zone_id                = data.aws_lb.compute_alb[0].zone_id
    evaluate_target_health = true
  }
}
