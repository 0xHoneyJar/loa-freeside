# =============================================================================
# DNS Root — Railway-hosted Service Records
# =============================================================================
# Explicit CNAMEs for services deployed on Railway. Without these, the
# wildcard CNAME (*.0xhoneyjar.xyz → cname.vercel-dns.com, declared in
# honeyjar-xyz-vercel.tf:8) catches the subdomain and routes it to Vercel —
# which 404s for any subdomain Vercel doesn't have a project for.
#
# Per RFC 4592 + the established pattern in honeyjar-xyz-worlds.tf:7,
# specific records win over the wildcard. This file mirrors the
# vercel/worlds separation: distinct file per upstream class, so the
# wildcard's blast radius is legible at-a-glance.
#
# Service-side requirement: the Railway service MUST also have the custom
# domain configured on its end (verified for identity-api via `railway
# domain` 2026-05-25: identity.0xhoneyjar.xyz IS present alongside the
# *.up.railway.app default). Without Railway-side registration, Railway's
# router won't accept the request even if DNS resolves correctly.
# =============================================================================

# identity-api — central identity SoR per ADR-009 §D-2.
# Without this record, the wildcard sends identity.0xhoneyjar.xyz to Vercel,
# breaking the PRODUCTION_BASE_URL fallback in
# mibera-honeyroad/lib/identity/client.ts (BERA→Soju visibility bug,
# diagnosed 2026-05-25, captured in
# grimoires/freeside-network/cluster-2026-05-25-operator-dash/README.md).
resource "aws_route53_record" "identity_api" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "identity.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["identity-api-production-317b.up.railway.app"]
}
