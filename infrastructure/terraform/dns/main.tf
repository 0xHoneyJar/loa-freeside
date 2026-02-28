# =============================================================================
# DNS Root — Terraform Configuration
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.1: dns/main.tf
# =============================================================================
#
# Separate state backend from compute root. DNS changes cannot risk compute resources.
# Initialize with: terraform init -backend-config=environments/<ring>/backend.tfvars

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.82.0" # IMP-002: Exact minor version pin for deterministic plans
    }
  }

  backend "s3" {
    bucket         = "arrakis-tfstate-891376933289"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arrakis-terraform-locks"
    # key is set via -backend-config at init time, e.g.:
    # terraform init -backend-config=environments/staging/backend.tfvars
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Arrakis"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Module      = "dns"
    }
  }
}

locals {
  name_prefix = "arrakis-${var.environment}"
}
