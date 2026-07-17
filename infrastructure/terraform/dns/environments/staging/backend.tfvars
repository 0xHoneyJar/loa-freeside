# =============================================================================
# DNS Root — Staging Backend Configuration
# =============================================================================
# Use with: terraform init -backend-config=environments/staging/backend.tfvars

bucket         = "arrakis-tfstate-AWS_ACCOUNT_ID_REDACTED"
key            = "dns/staging.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
