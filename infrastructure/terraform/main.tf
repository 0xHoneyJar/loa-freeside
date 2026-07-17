# Arrakis Infrastructure
# Version: 5.2 (Multi-Environment Support)
#
# Usage:
#   terraform init -backend-config=environments/staging/backend.tfvars -reconfigure
#   terraform plan -var-file=environments/staging/terraform.tfvars
#
#   terraform init -backend-config=environments/production/backend.tfvars -reconfigure
#   terraform plan -var-file=environments/production/terraform.tfvars

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Backend configuration is provided via -backend-config flag
  # See environments/*/backend.tfvars for environment-specific configs
  backend "s3" {
    # These values are overridden by backend.tfvars
    bucket         = "arrakis-tfstate-AWS_ACCOUNT_ID_REDACTED"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arrakis-terraform-locks"
    # key is set per-environment in backend.tfvars
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Arrakis"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# Local values
locals {
  name_prefix = "arrakis-${var.environment}"

  common_tags = {
    Project     = "Arrakis"
    Environment = var.environment
  }
}

# Vault token - uses pre-existing secret (create manually before terraform apply)
# aws secretsmanager create-secret --name arrakis-{environment}/vault-token --secret-string "your-token"
data "aws_secretsmanager_secret" "vault_token" {
  name = "${local.name_prefix}/vault-token"
}
