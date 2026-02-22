# =============================================================================
# PgBouncer Read-Only Pool for loa-finn (Cycle 036, Task 2.5)
# =============================================================================
#
# loa-finn connects to the database via PgBouncer using a read-only PostgreSQL
# role. This prevents loa-finn from modifying budget/user data — all writes go
# through loa-freeside.
#
# Architecture:
#   loa-finn → PgBouncer (6432) → RDS (5432) via loa_finn_ro role
#
# The read-only role is created by an init SQL script that runs on RDS.
# PgBouncer pool configuration is handled via the existing PgBouncer task
# definition's environment variables.
#
# @see SDD §1.4 PgBouncer Configuration
# @see Sprint 2, Task 2.5 Acceptance Criteria

# -----------------------------------------------------------------------------
# Secrets Manager: loa-finn read-only DB credentials
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "finn_db_credentials" {
  name                    = "${local.name_prefix}/finn-db-ro"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.id

  tags = merge(local.common_tags, {
    Service = "loa-finn"
    Sprint  = "C36-2"
    Access  = "read-only"
  })
}

resource "aws_secretsmanager_secret_version" "finn_db_credentials" {
  secret_id = aws_secretsmanager_secret.finn_db_credentials.id
  secret_string = jsonencode({
    host     = var.enable_service_discovery ? "pgbouncer.${local.name_prefix}.local" : "localhost"
    port     = 6432
    username = "loa_finn_ro"
    password = random_password.finn_db_password.result
    dbname   = aws_db_instance.main.db_name
    url      = "postgresql://loa_finn_ro:${random_password.finn_db_password.result}@pgbouncer.${local.name_prefix}.local:6432/${aws_db_instance.main.db_name}?sslmode=prefer&default_query_exec_mode=simple_protocol"
  })
}

resource "random_password" "finn_db_password" {
  length  = 32
  special = false
}

# -----------------------------------------------------------------------------
# RDS Init Script: Create read-only role
# -----------------------------------------------------------------------------
# This SQL is applied via a null_resource provisioner on first deploy.
# Subsequent runs are idempotent (IF NOT EXISTS / DO $$ ... END $$).
#
# Tables granted SELECT:
#   - communities, nft_metadata, personality_configs
#   - agent_threads, conviction_tiers
#   - s2s_jwks_public_keys (finn reads freeside's public keys)
#
# Enforcement: default_transaction_read_only = on
# Any INSERT/UPDATE/DELETE returns: ERROR: cannot execute ... in a read-only transaction

resource "null_resource" "finn_ro_role" {
  triggers = {
    # Re-run if password changes
    password_version = random_password.finn_db_password.result
  }

  provisioner "local-exec" {
    command = <<-SQL_INIT
      PGPASSWORD='${random_password.db_password.result}' psql \
        -h ${aws_db_instance.main.address} \
        -U ${aws_db_instance.main.username} \
        -d ${aws_db_instance.main.db_name} \
        -c "
          DO \$\$
          BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'loa_finn_ro') THEN
              CREATE ROLE loa_finn_ro LOGIN PASSWORD '${random_password.finn_db_password.result}';
            ELSE
              ALTER ROLE loa_finn_ro PASSWORD '${random_password.finn_db_password.result}';
            END IF;

            -- Enforce read-only at the role level
            ALTER ROLE loa_finn_ro SET default_transaction_read_only = on;

            -- Grant connect
            GRANT CONNECT ON DATABASE ${aws_db_instance.main.db_name} TO loa_finn_ro;

            -- Grant usage on public schema
            GRANT USAGE ON SCHEMA public TO loa_finn_ro;

            -- Grant SELECT on specific tables only
            GRANT SELECT ON
              communities,
              nft_metadata,
              agent_threads,
              s2s_jwks_public_keys
            TO loa_finn_ro;

            -- Revoke all other privileges (defense-in-depth)
            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM loa_finn_ro;
          END
          \$\$;
        "
    SQL_INIT

    environment = {
      PGCONNECT_TIMEOUT = "10"
    }
  }

  depends_on = [aws_db_instance.main]
}

# -----------------------------------------------------------------------------
# Update finn task definition to use PgBouncer read-only connection
# -----------------------------------------------------------------------------
# The finn ECS task definition in ecs-finn.tf reads DATABASE_URL from
# finn_db_credentials secret. No additional wiring needed here — the
# secret reference is already in ecs-finn.tf.

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "finn_db_ro_secret_arn" {
  description = "ARN of loa-finn read-only DB credentials secret"
  value       = aws_secretsmanager_secret.finn_db_credentials.arn
}

output "finn_pgbouncer_url" {
  description = "PgBouncer connection URL for loa-finn (read-only)"
  value       = "postgresql://loa_finn_ro:***@pgbouncer.${local.name_prefix}.local:6432/${aws_db_instance.main.db_name}"
  sensitive   = true
}
