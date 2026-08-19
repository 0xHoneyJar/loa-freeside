# =============================================================================
# Production Backend Configuration
# =============================================================================
# Use this with: terraform init -backend-config=environments/production/backend.tfvars
#
# Sprint 95 (A-94.2): KMS encryption for Terraform state
# The KMS key must be created before terraform init. See kms.tf for bootstrap steps.
# =============================================================================

bucket         = "REPLACE-WITH-YOUR-TFSTATE-BUCKET" # real value: private deploy fork / TFSTATE_BUCKET repo secret (CI)
key            = "production/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"

# Sprint 95: Customer-managed KMS encryption (A-94.2 remediation)
# Activated after KMS key alias/arrakis-terraform-state is created
kms_key_id = "alias/arrakis-terraform-state"
