#!/usr/bin/env bash
# tf-plan.sh — Terraform validation harness for gate checks
# Usage: scripts/tf-plan.sh [--validate-only]
#
# Runs terraform init -backend=false + validate + plan using example tfvars.
# No AWS credentials required. Exits 0 if plan succeeds (gate pass).

set -euo pipefail

TF_DIR="infrastructure/terraform"
TFVARS_EXAMPLE="${TF_DIR}/terraform.tfvars.example"

if [[ ! -d "$TF_DIR" ]]; then
  echo "ERROR: Terraform directory not found: $TF_DIR"
  exit 1
fi

if [[ ! -f "$TFVARS_EXAMPLE" ]]; then
  echo "ERROR: Example tfvars not found: $TFVARS_EXAMPLE"
  exit 1
fi

# Check terraform is installed
if ! command -v terraform &>/dev/null; then
  echo "ERROR: terraform not found. Install from https://www.terraform.io/downloads"
  exit 1
fi

echo "=== Terraform Validation Harness ==="
echo "Directory: $TF_DIR"
echo "Variables: $TFVARS_EXAMPLE"
echo ""

# Step 1: Init without backend
echo "[1/3] terraform init -backend=false"
terraform -chdir="$TF_DIR" init -backend=false -input=false -no-color 2>&1
echo ""

# Step 2: Validate
echo "[2/3] terraform validate"
terraform -chdir="$TF_DIR" validate -no-color 2>&1
echo ""

if [[ "${1:-}" == "--validate-only" ]]; then
  echo "=== GATE PASS (validate-only mode) ==="
  exit 0
fi

# Step 3: Plan (will show what would be created, no actual changes)
echo "[3/3] terraform plan (dry-run)"
terraform -chdir="$TF_DIR" plan \
  -var-file="terraform.tfvars.example" \
  -input=false \
  -no-color \
  2>&1

echo ""
echo "=== GATE PASS ==="
exit 0
