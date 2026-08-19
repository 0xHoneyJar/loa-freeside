# =============================================================================
# freeside-storage — Route53 alias (MANUAL per L5 + freeside-dns-state-untracked)
# =============================================================================
#
# Per project memory `freeside-dns-state-untracked`: production DNS records are
# NOT managed via terraform. Mixing terraform-managed and manual DNS in the
# same `apply` is a documented footgun (the proposed-to-create-duplicate-zone
# antipattern).
#
# Approach:
#   1. terraform apply (creates ACM cert + OAC + distribution)
#   2. Operator MANUALLY creates the alias A/AAAA record in the AWS console:
#        Hosted zone:  0xhoneyjar.xyz (Z01393483Y40WF3N1H76)
#        Record name:  assets
#        Record type:  A (alias) + AAAA (alias)
#        Alias target: <terraform output cloudfront_distribution_domain>
#        Hosted zone:  Z2FDTNDATAQYW2 (CloudFront's global zone, fixed)
#   3. Manual record creation is logged to:
#        loa-freeside/decisions/cloudfront-dns-2026-04-29.md
#
# Future cycle SHOULD:
#   - Import the manual records into terraform state
#   - Uncomment the resource block below
#   - Make a one-shot apply that takes ownership cleanly
#
# Reference: SDD §7.5
# =============================================================================

# resource "aws_route53_record" "alias_a" {
#   zone_id = data.aws_route53_zone.parent.zone_id
#   name    = var.alias_fqdn
#   type    = "A"
#
#   alias {
#     name                   = aws_cloudfront_distribution.main.domain_name
#     zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
#     evaluate_target_health = false
#   }
# }
#
# resource "aws_route53_record" "alias_aaaa" {
#   zone_id = data.aws_route53_zone.parent.zone_id
#   name    = var.alias_fqdn
#   type    = "AAAA"
#
#   alias {
#     name                   = aws_cloudfront_distribution.main.domain_name
#     zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
#     evaluate_target_health = false
#   }
# }
#
# data "aws_route53_zone" "parent" {
#   name         = var.hosted_zone_name
#   private_zone = false
# }
