# =============================================================================
# DNS Root — Security (CAA + DNSSEC)
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.8: dns/security.tf
# =============================================================================

# CAA records — restrict certificate issuance
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.honeyjar.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"letsencrypt.org\"",
    "0 issue \"amazon.com\"",
    "0 issuewild \"letsencrypt.org\"",
    "0 iodef \"mailto:security@0xhoneyjar.xyz\""
  ]
}

# DNSSEC (gated by feature flag)
resource "aws_route53_key_signing_key" "honeyjar" {
  count = var.enable_dnssec ? 1 : 0

  hosted_zone_id             = aws_route53_zone.honeyjar.zone_id
  key_management_service_arn = aws_kms_key.dnssec[0].arn
  name                       = "${var.domain}-ksk"
}

resource "aws_route53_hosted_zone_dnssec" "honeyjar" {
  count = var.enable_dnssec ? 1 : 0

  hosted_zone_id = aws_route53_zone.honeyjar.zone_id

  depends_on = [aws_route53_key_signing_key.honeyjar[0]]
}

resource "aws_kms_key" "dnssec" {
  count = var.enable_dnssec ? 1 : 0

  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 7
  key_usage                = "SIGN_VERIFY"
  description              = "DNSSEC KSK for ${var.domain}"

  # SKP-002: Explicit admin roles, no root kms:*
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowKeyAdministration"
        Effect = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/github-actions-terraform",
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/admin"
          ]
        }
        Action = [
          "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*",
          "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*",
          "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
          "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"
        ]
        Resource = "*"
      },
      {
        Sid    = "AllowRoute53DNSSEC"
        Effect = "Allow"
        Principal = { Service = "dnssec-route53.amazonaws.com" }
        Action   = ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign", "kms:CreateGrant"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

data "aws_caller_identity" "current" {}
