# =============================================================================
# World Module — EFS Access Point
# =============================================================================

resource "aws_efs_access_point" "world" {
  file_system_id = var.efs_file_system_id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/worlds/${var.name}"

    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = merge(local.tags, { Name = "${local.world_name}-efs-ap" })
}
