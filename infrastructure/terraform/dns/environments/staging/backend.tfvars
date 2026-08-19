# =============================================================================
# DNS Root — Staging Backend Configuration
# =============================================================================
# Use with: terraform init -backend-config=environments/staging/backend.tfvars

bucket         = "REPLACE-WITH-YOUR-TFSTATE-BUCKET" # real value: private deploy fork / TFSTATE_BUCKET repo secret (CI)
key            = "dns/staging.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"
