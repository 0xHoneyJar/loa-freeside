# =============================================================================
# DNS Root — Vercel Deployment Records
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.5: dns/honeyjar-xyz-vercel.tf
# =============================================================================

# Wildcard CNAME for Vercel deployments
resource "aws_route53_record" "wildcard" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "*.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}

# ACME challenge NS delegation to Vercel (for SSL cert issuance)
resource "aws_route53_record" "acme_challenge" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_acme-challenge.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = ["ns1.vercel-dns.com.", "ns2.vercel-dns.com."]
}
