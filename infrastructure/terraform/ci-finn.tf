# =============================================================================
# GitHub Actions OIDC for loa-finn CI Deploys
# =============================================================================
# Creates an IAM role that loa-finn's GitHub Actions can assume via OIDC
# to push Docker images to ECR and trigger ECS redeployments.
#
# Usage in loa-finn's .github/workflows/deploy-staging.yml:
#   role-to-assume: <output.finn_ci_deploy_role_arn>
#
# References:
#   - loa-finn issue #114 (staging infra migration)
#   - Finn's deploy-staging.yml uses aws-actions/configure-aws-credentials
#     with role-to-assume (OIDC, not static credentials)
# =============================================================================

# GitHub OIDC provider (account-level singleton)
# Created as a resource since no pre-existing provider was found in account 891376933289.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags = merge(local.common_tags, { Name = "GitHub Actions OIDC" })
}

# --- IAM Role for loa-finn CI ---

resource "aws_iam_role" "finn_ci_deploy" {
  name = "${local.name_prefix}-finn-ci-deploy"

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
            "repo:0xHoneyJar/loa-finn:ref:refs/heads/main",
            "repo:0xHoneyJar/loa-finn:environment:staging"
          ]
        }
      }
    }]
  })

  tags = merge(local.common_tags, {
    Service = "Finn"
    Purpose = "CI/CD deploy from GitHub Actions"
  })
}

# --- Least-Privilege Policy: ECR Push + ECS Deploy ---

resource "aws_iam_role_policy" "finn_ci_deploy" {
  name = "${local.name_prefix}-finn-ci-deploy-policy"
  role = aws_iam_role.finn_ci_deploy.id

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
        Resource = aws_ecr_repository.finn.arn
      },
      {
        Sid    = "ECSDeployFinn"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${aws_ecs_cluster.main.name}/${local.name_prefix}-finn"
      }
    ]
  })
}

# --- Output for Finn repo secrets ---

output "finn_ci_deploy_role_arn" {
  description = "IAM role ARN for loa-finn GitHub Actions (set as AWS_DEPLOY_ROLE_ARN secret)"
  value       = aws_iam_role.finn_ci_deploy.arn
}
