# =============================================================================
# World EFS File System — Shared persistent storage for all worlds
# =============================================================================
# Each world gets an EFS access point at /worlds/{name}/ via the world module.
# IAM authorization enforces per-world isolation at the access point level.
#
# Refs: PRD FR-1 (EFS Configuration), SDD §5 (EFS Design)
# =============================================================================

resource "aws_efs_file_system" "worlds" {
  creation_token = "${local.name_prefix}-worlds"
  encrypted      = true
  kms_key_id     = aws_kms_key.secrets.arn

  performance_mode = "generalPurpose"
  throughput_mode  = "elastic"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-worlds-efs"
    Service = "Worlds"
  })
}

# Mount targets in each private subnet
resource "aws_efs_mount_target" "worlds" {
  count           = length(module.vpc.private_subnets)
  file_system_id  = aws_efs_file_system.worlds.id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_groups = [aws_security_group.worlds_efs.id]
}

# Security group for EFS mount targets
resource "aws_security_group" "worlds_efs" {
  name        = "${local.name_prefix}-worlds-efs"
  description = "EFS mount targets for world containers"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "NFS from VPC"
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-worlds-efs"
    Service = "Worlds"
  })
}

# Output for module consumption
output "worlds_efs_id" {
  description = "Worlds EFS file system ID"
  value       = aws_efs_file_system.worlds.id
}

output "worlds_efs_sg_id" {
  description = "Worlds EFS security group ID"
  value       = aws_security_group.worlds_efs.id
}
