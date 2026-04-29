# =============================================================================
# freeside-storage — Provider Version Constraints
# =============================================================================
#
# CloudFront + ACM require the us-east-1 region. The caller MUST supply two
# AWS provider configurations:
#
#   provider "aws" {
#     region = "us-west-2"  # or wherever the backing thj-assets bucket lives
#   }
#
#   provider "aws" {
#     alias  = "us_east_1"
#     region = "us-east-1"  # ACM cert + CloudFront require this
#   }
#
# Then pass both into this module:
#
#   module "freeside_storage" {
#     source = "./freeside-storage"
#     providers = {
#       aws           = aws
#       aws.us_east_1 = aws.us_east_1
#     }
#     # ...vars
#   }
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}
