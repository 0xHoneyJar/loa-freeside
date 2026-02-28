# =============================================================================
# DNS Root — Email Records (Google Workspace)
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.4: dns/honeyjar-xyz-email.tf
# =============================================================================

# MX records — Google Workspace
resource "aws_route53_record" "mx" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = 3600

  records = [for mx in var.google_workspace_mx : "${mx.priority} ${mx.value}"]
}

# SPF
resource "aws_route53_record" "spf" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:_spf.google.com ~all"]
}

# DKIM (Google Workspace)
resource "aws_route53_record" "dkim" {
  count = var.dkim_key != "" ? 1 : 0

  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "google._domainkey.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = [var.dkim_key]
}

# DMARC (FIXED — replaces broken Gandi placeholder)
resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=quarantine; rua=mailto:${var.dmarc_email}; ruf=mailto:${var.dmarc_email}; fo=1"]
}
