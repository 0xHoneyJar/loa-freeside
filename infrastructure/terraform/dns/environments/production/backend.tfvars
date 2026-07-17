# =============================================================================
# DNS Root — Production Backend Configuration
# =============================================================================
# Use with: terraform init -backend-config=environments/production/backend.tfvars

bucket         = "arrakis-tfstate-AWS_ACCOUNT_ID_REDACTED"
key            = "dns/production.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
