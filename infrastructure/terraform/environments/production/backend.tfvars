# =============================================================================
# Production Backend Configuration
# =============================================================================
# Use this with: terraform init -backend-config=environments/production/backend.tfvars
# =============================================================================

bucket         = "arrakis-tfstate-891376933289"
key            = "production/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
