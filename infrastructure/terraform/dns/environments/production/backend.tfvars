# =============================================================================
# DNS Root — Production Backend Configuration
# =============================================================================
# Use with: terraform init -backend-config=environments/production/backend.tfvars

bucket         = "REPLACE-WITH-YOUR-TFSTATE-BUCKET" # real value: private deploy fork / TFSTATE_BUCKET repo secret (CI)
key            = "dns/production.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
