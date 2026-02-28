# =============================================================================
# Production Environment Configuration
# =============================================================================
# This file contains production-specific variable values.
#
# Usage:
#   terraform plan -var-file=environments/production/terraform.tfvars
#   terraform apply -var-file=environments/production/terraform.tfvars
# =============================================================================

environment = "production"

# VPC
vpc_cidr = "10.0.0.0/16"

# ECS - Production sizing
api_cpu           = 512
api_memory        = 1024
api_desired_count = 2

# RDS - Production sizing
db_instance_class    = "db.t3.small"
db_allocated_storage = 20

# ElastiCache
redis_node_type = "cache.t3.micro"

# Domain
domain_name = "api.arrakis.community"

# =============================================================================
# Cycle 046: Armitage Platform — Finn/Dixie Consolidation
# =============================================================================

# Finn dedicated Redis
finn_redis_node_type = "cache.t3.micro"

# Dixie auto-scaling
dixie_max_count = 4  # Production: allow scale-out to 4
