# =============================================================================
# DNS Root — Agent Economy Records
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.6: dns/honeyjar-xyz-agents.tf
# =============================================================================
#
# Agent DNS Architecture (see docs/adr/003-agent-dns-programmatic-management.md):
#
# Tier 1 (this file, Terraform-managed):
#   - *.agents.0xhoneyjar.xyz CNAME → Vercel (wildcard fallback)
#   - agents.0xhoneyjar.xyz A → Vercel (bare subdomain)
#   - _acme-challenge.agents CNAME → Vercel (TLS delegation)
#
# Tier 2 (application API-managed, NOT in Terraform state):
#   - <agent-slug>.agents.0xhoneyjar.xyz → per-agent endpoints
#   - Per RFC 4592, specific records take precedence over wildcard
#
# IMPORTANT: Do not add per-agent records to this file.
# They are managed by the agent platform service via Route 53 API.

# Agent economy wildcard: *.agents.0xhoneyjar.xyz
# More specific than *.0xhoneyjar.xyz per RFC 4592 — no conflict
# Conservation invariant: wildcard is the safety net for all agents without
# specific records. prevent_destroy ensures it cannot be accidentally deleted.
resource "aws_route53_record" "agents_wildcard" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "*.agents.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]

  lifecycle {
    prevent_destroy = true
  }
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
