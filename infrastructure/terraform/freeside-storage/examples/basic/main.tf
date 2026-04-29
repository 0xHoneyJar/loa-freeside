# =============================================================================
# freeside-storage — Basic example
# =============================================================================
#
# Smallest viable consumer of the module. Used for `terraform validate`
# (proves consumability per T4 acceptance) AND as a copy-paste starting
# point for the production root module that consumes freeside-storage.
#
# Run:
#   terraform init -backend=false
#   terraform validate
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2" # where thj-assets lives
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1" # ACM cert + CloudFront require this
}

module "freeside_storage" {
  source = "../.."

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  alias_fqdn            = "assets.0xhoneyjar.xyz"
  backing_bucket_name   = "thj-assets"
  backing_bucket_region = "us-west-2"
  hosted_zone_name      = "0xhoneyjar.xyz"
}

output "distribution_id" {
  value = module.freeside_storage.cloudfront_distribution_id
}

output "distribution_domain" {
  value = module.freeside_storage.cloudfront_distribution_domain
}

output "alias_fqdn" {
  value = module.freeside_storage.alias_fqdn
}

output "acm_validation_records" {
  value = module.freeside_storage.acm_validation_records
}
