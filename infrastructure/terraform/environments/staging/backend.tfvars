# =============================================================================
# Staging Backend Configuration
# =============================================================================
# Use this with: terraform init -backend-config=environments/staging/backend.tfvars
# =============================================================================

bucket         = "arrakis-tfstate-891376933289"
key            = "staging/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
