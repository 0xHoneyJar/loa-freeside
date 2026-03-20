# =============================================================================
# GitHub Actions OIDC for loa-dixie CI Deploys
# =============================================================================
# Creates an IAM role that loa-dixie's GitHub Actions can assume via OIDC
# to push Docker images to ECR and trigger ECS redeployments.
#
# Usage in loa-dixie's .github/workflows/deploy.yml:
#   role-to-assume: <output.dixie_ci_deploy_role_arn>
#
# References:
#   - loa-finn #131 Phase 1 (dNFT launch critical path)
#   - loa-finn #66 Round 13 Addendum (Dixie CI gap identified)
#   - Pattern: identical to ci-finn.tf
# =============================================================================

# NOTE: aws_iam_openid_connect_provider.github is defined in ci-finn.tf
# (account-level singleton — one per AWS account, shared by all repos)

# --- IAM Role for loa-dixie CI ---

resource "aws_iam_role" "dixie_ci_deploy" {
  name = "${local.name_prefix}-dixie-ci-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Allow main branch pushes and environment-scoped tokens
          "token.actions.githubusercontent.com:sub" = [
            "repo:0xHoneyJar/loa-dixie:ref:refs/heads/main",
            "repo:0xHoneyJar/loa-dixie:environment:staging"
          ]
        }
      }
    }]
  })

  tags = merge(local.common_tags, {
    Service = "Dixie"
    Purpose = "CI/CD deploy from GitHub Actions"
  })
}

# --- Least-Privilege Policy: ECR Push + ECS Deploy ---

resource "aws_iam_role_policy" "dixie_ci_deploy" {
  name = "${local.name_prefix}-dixie-ci-deploy-policy"
  role = aws_iam_role.dixie_ci_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = aws_ecr_repository.dixie.arn
      },
      {
        Sid    = "ECSDeployDixie"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${aws_ecs_cluster.main.name}/${local.name_prefix}-dixie"
      }
    ]
  })
}

# --- Output for Dixie repo secrets ---

output "dixie_ci_deploy_role_arn" {
  description = "IAM role ARN for loa-dixie GitHub Actions (set as AWS_DEPLOY_ROLE_ARN secret)"
  value       = aws_iam_role.dixie_ci_deploy.arn
}
