# =============================================================================
# World Module — Security Group
# =============================================================================

resource "aws_security_group" "world" {
  name        = local.world_name
  description = "Security group for world ${var.name}"
  vpc_id      = var.vpc_id

  # Ingress: ALB health checks + traffic
  ingress {
    from_port       = var.port
    to_port         = var.port
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
    description     = "ALB traffic"
  }

  # Egress: HTTPS (external APIs, Secrets Manager, ECR)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound"
  }

  # Egress: NFS to EFS
  egress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [var.efs_security_group_id]
    description     = "EFS mount"
  }

  # Egress: Finn AI gateway (Cloud Map internal)
  egress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "Finn AI gateway via Cloud Map"
  }

  tags = local.tags
}
