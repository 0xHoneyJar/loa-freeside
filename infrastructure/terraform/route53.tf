# =============================================================================
# Route 53 Public Hosted Zone
# =============================================================================
# This creates a public hosted zone for arrakis.community
# After creation, you must update nameservers at your domain registrar (Gandi)
# =============================================================================

# Public hosted zone for arrakis.community
resource "aws_route53_zone" "main" {
  name    = var.root_domain
  comment = "Public DNS zone for ${var.root_domain} - managed by Terraform"

  tags = merge(local.common_tags, {
    Name = var.root_domain
  })
}

# -----------------------------------------------------------------------------
# DNS Records for ACM Certificate Validation
# -----------------------------------------------------------------------------
# These records are required to validate the SSL certificate
resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
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
  zone_id         = aws_route53_zone.main.zone_id
}

# Update ACM validation to use Route 53 records
resource "aws_acm_certificate_validation" "main_with_route53" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]

  timeouts {
    create = "30m"
  }
}

# -----------------------------------------------------------------------------
# API Endpoint Record
# -----------------------------------------------------------------------------
# Points the API subdomain to the ALB
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain_name  # e.g., staging.api.arrakis.community
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# -----------------------------------------------------------------------------
# Cycle 044: Dixie Endpoint Record (SDD §2.4)
# Points dixie subdomain to the same ALB (host-based routing)
# -----------------------------------------------------------------------------
resource "aws_route53_record" "dixie" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "dixie.${var.environment}.${var.root_domain}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "route53_zone_id" {
  description = "Route 53 hosted zone ID"
  value       = aws_route53_zone.main.zone_id
}

output "route53_nameservers" {
  description = "Route 53 nameservers - UPDATE THESE AT YOUR DOMAIN REGISTRAR"
  value       = aws_route53_zone.main.name_servers
}

output "api_dns_name" {
  description = "API endpoint DNS name"
  value       = aws_route53_record.api.fqdn
}
