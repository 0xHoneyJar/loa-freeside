# =============================================================================
# DNS Root — Agent Economy Records
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.6: dns/honeyjar-xyz-agents.tf
# =============================================================================

# Agent economy wildcard: *.agents.0xhoneyjar.xyz
# More specific than *.0xhoneyjar.xyz per RFC 4592 — no conflict
resource "aws_route53_record" "agents_wildcard" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "*.agents.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}

# Bare agents.0xhoneyjar.xyz (explicit, prevents lookup failures)
resource "aws_route53_record" "agents_bare" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "agents.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [var.vercel_anycast_ip]
}

# ACME challenge delegation for agent wildcard certs
resource "aws_route53_record" "agents_acme" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_acme-challenge.agents.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = ["ns1.vercel-dns.com.", "ns2.vercel-dns.com."]
}
