# =============================================================================
# DNS Root — Outputs
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.9: dns/outputs.tf
# =============================================================================

output "zone_id" {
  value = aws_route53_zone.honeyjar.zone_id
}

output "nameservers" {
  value       = aws_route53_zone.honeyjar.name_servers
  description = "Set these as NS records at Gandi registrar"
}

output "ds_record" {
  value       = var.enable_dnssec ? aws_route53_key_signing_key.honeyjar[0].ds_record : "DNSSEC not enabled"
  description = "DS record to upload to Gandi for DNSSEC chain"
}
