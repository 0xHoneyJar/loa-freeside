# GitHub Actions OIDC deploy roles — replaces the long-lived AWS keys that were
# stored (and removed 2026-08-19) as Actions secrets in this PUBLIC repo.
#
# WHY: a public repo must never hold long-lived cloud credentials. OIDC issues a
# short-lived STS token per workflow run, scoped by the GitHub identity's `sub`
# claim, with nothing stored. This follows the existing fleet convention
# (arrakis-{env}-{service}-ci-deploy; cf. the dixie/finn/world-* deploy roles).
#
# APPLY ORDERING (operator): apply THIS with a valid credential FIRST, then set
# the two repo variables (AWS_DEPLOY_ROLE_ARN_STAGING / _PROD) to the role ARNs,
# then the converted workflows self-sustain. Deploys stay fail-closed until then.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  # SCOPING DECISION — operator confirm: trust is limited to this repo's default
  # branch. If production deploys actually run from the PRIVATE fork
  # (hosaka-fm/freeside), add "repo:hosaka-fm/freeside:ref:refs/heads/main" to the
  # relevant role's subs and REMOVE whichever repo does not deploy (least privilege).
  ci_repo = "0xHoneyJar/loa-freeside"

  # Operations enumerated from the workflows (2026-08-19): ECR login/push +
  # lifecycle, ECS register/update/run/describe/exec. Deliberately NOT the broad
  # arrakis-deployer grant — this is scoped to what CI actually calls.
  ecr_actions = [
    "ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability",
    "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:DescribeImages",
    "ecr:DescribeRepositories", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:CreateRepository",
    "ecr:PutLifecyclePolicy",
  ]
  ecs_actions = [
    "ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition",
    "ecs:DescribeTaskDefinition", "ecs:UpdateService", "ecs:DescribeServices",
    "ecs:DescribeTasks", "ecs:ListTasks", "ecs:RunTask", "ecs:ExecuteCommand",
  ]
}

# Trust policy factory — one per environment, scoped to the CI repo's main ref.
data "aws_iam_policy_document" "ci_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.ci_repo}:ref:refs/heads/main"]
    }
  }
}

# ── Staging deploy role (deploy-staging / -ingestor / -gp-worker / build-base-image) ──
resource "aws_iam_role" "ci_deploy_staging" {
  name               = "arrakis-staging-freeside-ci-deploy"
  assume_role_policy = data.aws_iam_policy_document.ci_deploy_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "ci_deploy_staging" {
  statement {
    sid       = "EcrPushAndRead"
    effect    = "Allow"
    actions   = local.ecr_actions
    resources = ["*"] # ECR GetAuthorizationToken requires "*"; tighten push actions to arrakis-staging-* repos if desired
  }
  statement {
    sid       = "EcsStagingDeploy"
    effect    = "Allow"
    actions   = local.ecs_actions
    resources = ["*"] # operator: scope to arn:aws:ecs:us-east-1:<acct>:*/arrakis-staging-* once verified
  }
  statement {
    sid       = "PassTaskRolesStaging"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["*"] # REQUIRED by RegisterTaskDefinition/RunTask; MUST be tightened to the arrakis-staging task/exec role ARNs before merge
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ci_deploy_staging" {
  name   = "arrakis-staging-freeside-ci-deploy"
  role   = aws_iam_role.ci_deploy_staging.id
  policy = data.aws_iam_policy_document.ci_deploy_staging.json
}

# ── Production deploy role (deploy-production only) ──
resource "aws_iam_role" "ci_deploy_production" {
  name               = "arrakis-production-freeside-ci-deploy"
  assume_role_policy = data.aws_iam_policy_document.ci_deploy_trust.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "ci_deploy_production" {
  statement {
    sid       = "EcrReadAndPush"
    effect    = "Allow"
    actions   = local.ecr_actions
    resources = ["*"]
  }
  statement {
    sid       = "EcsProductionDeploy"
    effect    = "Allow"
    actions   = local.ecs_actions
    resources = ["*"] # operator: scope to arrakis-production-* once verified
  }
  statement {
    sid       = "PassTaskRolesProduction"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["*"] # tighten to arrakis-production task/exec role ARNs before merge
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ci_deploy_production" {
  name   = "arrakis-production-freeside-ci-deploy"
  role   = aws_iam_role.ci_deploy_production.id
  policy = data.aws_iam_policy_document.ci_deploy_production.json
}

output "ci_deploy_role_arns" {
  description = "Set these as repo variables AWS_DEPLOY_ROLE_ARN_STAGING / _PROD (Settings > Actions > Variables). ARNs contain the account id and are NOT stored in source - variables keep them out of the public tree."
  value = {
    staging    = aws_iam_role.ci_deploy_staging.arn
    production = aws_iam_role.ci_deploy_production.arn
  }
}
