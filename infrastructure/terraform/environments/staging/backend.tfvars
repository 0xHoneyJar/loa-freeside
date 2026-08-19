# =============================================================================
# Staging Backend Configuration
# =============================================================================
# Use this with: terraform init -backend-config=environments/staging/backend.tfvars
#
# Sprint 95 (A-94.2): KMS encryption for Terraform state
# The KMS key must be created before terraform init. See kms.tf for bootstrap steps.
# =============================================================================

bucket         = "arrakis-tfstate-AWS_ACCOUNT_ID_REDACTED"
key            = "staging/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "arrakis-terraform-locks"

# Sprint 95: Customer-managed KMS encryption (A-94.2 remediation)
# Activated after KMS key alias/arrakis-terraform-state is created
kms_key_id = "alias/arrakis-terraform-state"
