# =============================================================================
# Dedicated Finn Redis (ElastiCache Replication Group)
# Cycle 046: Armitage Platform — Sprint 1, Task 1.2
# SDD §3.1: elasticache-finn.tf
# =============================================================================
#
# Dedicated Redis for Finn billing (noeviction + AOF). Separate from the
# shared Redis cluster to isolate billing data and enforce persistence
# guarantees. Auth token is managed externally via bootstrap script (SKP-003).

resource "aws_elasticache_replication_group" "finn_dedicated" {
  replication_group_id = "${local.name_prefix}-finn-redis"
  description          = "Dedicated Redis for Finn billing (noeviction + AOF)"

  node_type            = var.finn_redis_node_type
  num_cache_clusters   = 1
  engine_version       = "7.1"
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.finn_redis.name

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # SKP-003: Do NOT set auth_token in Terraform to avoid storing it in state.
  # Auth token is managed out-of-band via:
  #   scripts/bootstrap-redis-auth.sh → aws elasticache modify-replication-group
  # See SDD §3.1 external secret provisioning notes.

  subnet_group_name  = aws_elasticache_subnet_group.main.name # reuse existing
  security_group_ids = [aws_security_group.finn_redis.id]

  snapshot_retention_limit = 7
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:04:00-sun:05:00"

  apply_immediately = false

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [auth_token] # Managed externally after bootstrap
  }

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "billing-ledger"
  })
}

resource "aws_elasticache_parameter_group" "finn_redis" {
  family = "redis7"
  name   = "${local.name_prefix}-finn-redis-params"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }

  parameter {
    name  = "appendonly"
    value = "yes"
  }

  parameter {
    name  = "appendfsync"
    value = "everysec"
  }
}

resource "aws_security_group" "finn_redis" {
  name_prefix = "${local.name_prefix}-finn-redis-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.finn.id]
    description     = "Redis from Finn service only"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-finn-redis" })
}

# SKP-003: Redis auth token provisioned externally (not in TF state).
# A bootstrap script generates the auth token and stores it in Secrets Manager.
# Terraform only references the secret, never the plaintext.
resource "aws_secretsmanager_secret" "finn_redis" {
  name       = "${local.name_prefix}/finn/redis"
  kms_key_id = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    Service = "finn"
    Purpose = "redis-credentials"
  })
}

# Secret value is populated by scripts/bootstrap-redis-auth.sh:
#   1. Generate 64-char cryptographically strong token from /dev/urandom
#   2. aws elasticache modify-replication-group --auth-token <token> --auth-token-update-strategy ROTATE
#   3. Verify ElastiCache accepts the new token
#   4. aws secretsmanager put-secret-value --secret-id <secret_arn> --secret-string '{"host":..., "auth":...}'
# This ensures plaintext credentials never appear in Terraform state.
# Rotation cadence: quarterly, or on security incident.
