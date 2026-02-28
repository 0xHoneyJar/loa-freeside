# =============================================================================
# DNS Root — Zone & Apex Records
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.3: dns/honeyjar-xyz.tf
# =============================================================================

resource "aws_route53_zone" "honeyjar" {
  name    = var.domain
  comment = "Managed by Terraform (Armitage Platform)"

  tags = {
    Project = "Arrakis"
    Purpose = "production-dns"
  }
}

# Apex A record → Vercel
resource "aws_route53_record" "apex_a" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "A"
  ttl     = 300
  records = [var.vercel_anycast_ip]
}

# www CNAME → Vercel
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}
