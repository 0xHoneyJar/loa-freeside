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

# score-api — THJ scoring/leaderboard (Railway production compute).
# Canonical public hostname per packages/freeside-registry/registry.yaml beacon_url.
# ECS module.world_score_api + score-api.0xhoneyjar.xyz ALB path is DORMANT (#417).
resource "aws_route53_record" "score_api" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "score.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["score-api-production.up.railway.app"]
}

# cluster-nats — self-hosted nats-server for cluster-events-pillar-v1 (Path ε,
# 2026-05-26). Hosts: sonar-api publisher + characters-bot subscriber +
# operator-dash subscriber. mTLS via cluster-owned CA.
#
# Railway side: nats:2.10-alpine in `cluster-nats` Railway project, TCP proxy
# enabled on internal port 4222. Railway assigns proxy host+port (TCP unlike
# HTTP doesn't get a Railway-side custom-domain record — DNS CNAME below is
# the only operator-side step needed beyond enabling TCP proxy).
#
# Clients connect via: tls://nats.0xhoneyjar.xyz:48352
# (port 48352 stays — only the hostname is replaced by this CNAME per Railway
# TCP proxy contract: https://docs.railway.com/networking/tcp-proxy)
#
# Server cert SAN includes both `nats.0xhoneyjar.xyz` and `zephyr.proxy.rlwy.net`
# so TLS hostname validation passes via either path during DNS propagation.
resource "aws_route53_record" "cluster_nats" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = "nats.${var.domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["zephyr.proxy.rlwy.net"]
}
