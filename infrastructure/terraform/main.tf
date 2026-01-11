# Arrakis Production Infrastructure
# Version: 5.1 (Post-Security Hardening)

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

  backend "s3" {
    bucket         = "arrakis-tfstate-891376933289"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arrakis-terraform-locks"
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

# Vault token stored in AWS Secrets Manager (bootstrap)
resource "aws_secretsmanager_secret" "vault_token" {
  name                    = "${local.name_prefix}/vault-token"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "vault_token" {
  secret_id     = aws_secretsmanager_secret.vault_token.id
  secret_string = var.vault_token
}
