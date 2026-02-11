# BYOK Network-Layer SSRF Defense
# Sprint 3, Task 3.7: Network Firewall domain allowlist, dedicated subnet, VPC Flow Logs
#
# Defense-in-depth: application-layer SSRF blocking (byok-proxy-handler.ts) +
# network-layer egress restriction (this file).
#
# @see SDD §3.4.5 BYOK Proxy Handler
# @see Sprint Plan Task 3.7 (AC-4.24 through AC-4.28)

# --------------------------------------------------------------------------
# BYOK Feature Gate
# --------------------------------------------------------------------------

variable "byok_enabled" {
  description = "Enable BYOK network infrastructure (Network Firewall, dedicated subnet)"
  type        = bool
  default     = false
}

# --------------------------------------------------------------------------
# Dedicated BYOK Subnet
# --------------------------------------------------------------------------
# BYOK proxy ECS tasks run in an isolated subnet with restricted routing.
# Egress flows through Network Firewall before reaching the internet.

resource "aws_subnet" "byok_proxy" {
  count = var.byok_enabled ? length(var.availability_zones) : 0

  vpc_id            = module.vpc.vpc_id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 200 + count.index)
  availability_zone = var.availability_zones[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-proxy-${var.availability_zones[count.index]}"
    Role = "byok-proxy"
  })
}

# --------------------------------------------------------------------------
# Network Firewall — Domain Allowlist (AC-4.24, AC-4.25)
# --------------------------------------------------------------------------
# Stateful domain inspection: only allow egress to provider FQDNs.
# All other domains are denied and logged.

resource "aws_networkfirewall_rule_group" "byok_domain_allowlist" {
  count = var.byok_enabled ? 1 : 0

  capacity = 100
  name     = "${local.name_prefix}-byok-domain-allowlist"
  type     = "STATEFUL"

  rule_group {
    rules_source {
      rules_source_list {
        generated_rules_type = "ALLOWLIST"
        target_types         = ["TLS_SNI", "HTTP_HOST"]
        targets = [
          # Must match PROVIDER_ENDPOINTS in byok-provider-endpoints.ts
          "api.openai.com",
          "api.anthropic.com",
        ]
      }
    }

    stateful_rule_options {
      capacity = 100
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-domain-allowlist"
  })
}

resource "aws_networkfirewall_firewall_policy" "byok" {
  count = var.byok_enabled ? 1 : 0

  name = "${local.name_prefix}-byok-firewall-policy"

  firewall_policy {
    stateless_default_actions          = ["aws:forward_to_sfe"]
    stateless_fragment_default_actions = ["aws:drop"]

    stateful_rule_group_reference {
      resource_arn = aws_networkfirewall_rule_group.byok_domain_allowlist[0].arn
    }

    # Default action for stateful rules: drop and alert on non-allowlisted domains
    stateful_default_actions = ["aws:drop_established", "aws:alert_established"]

    stateful_engine_options {
      rule_order = "STRICT_ORDER"
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-firewall-policy"
  })
}

resource "aws_networkfirewall_firewall" "byok" {
  count = var.byok_enabled ? 1 : 0

  name                = "${local.name_prefix}-byok-firewall"
  firewall_policy_arn = aws_networkfirewall_firewall_policy.byok[0].arn
  vpc_id              = module.vpc.vpc_id

  dynamic "subnet_mapping" {
    for_each = aws_subnet.byok_proxy
    content {
      subnet_id = subnet_mapping.value.id
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-firewall"
  })
}

# --------------------------------------------------------------------------
# Network Firewall Logging — Deny events to CloudWatch (AC-4.25)
# --------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "byok_firewall" {
  count = var.byok_enabled ? 1 : 0

  name              = "/aws/network-firewall/${local.name_prefix}-byok"
  retention_in_days = 90

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-firewall-logs"
  })
}

resource "aws_networkfirewall_logging_configuration" "byok" {
  count = var.byok_enabled ? 1 : 0

  firewall_arn = aws_networkfirewall_firewall.byok[0].arn

  logging_configuration {
    log_destination_config {
      log_destination = {
        logGroup = aws_cloudwatch_log_group.byok_firewall[0].name
      }
      log_destination_type = "CloudWatchLogs"
      log_type             = "ALERT"
    }
  }
}

# --------------------------------------------------------------------------
# Route Table — BYOK subnet egress through Network Firewall
# --------------------------------------------------------------------------

resource "aws_route_table" "byok_proxy" {
  count = var.byok_enabled ? 1 : 0

  vpc_id = module.vpc.vpc_id

  # Route internet-bound traffic through Network Firewall
  route {
    cidr_block      = "0.0.0.0/0"
    vpc_endpoint_id = one([for ep in aws_networkfirewall_firewall.byok[0].firewall_status[0].sync_states : ep.attachment[0].endpoint_id])
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-proxy-rt"
  })
}

resource "aws_route_table_association" "byok_proxy" {
  count = var.byok_enabled ? length(var.availability_zones) : 0

  subnet_id      = aws_subnet.byok_proxy[count.index].id
  route_table_id = aws_route_table.byok_proxy[0].id
}

# --------------------------------------------------------------------------
# Security Group — BYOK Proxy (AC-4.26)
# --------------------------------------------------------------------------
# Outbound: port 443 only (TLS to provider APIs)
# Inbound: from VPC only (ECS service mesh)

resource "aws_security_group" "byok_proxy" {
  count = var.byok_enabled ? 1 : 0

  name_prefix = "${local.name_prefix}-byok-proxy-"
  vpc_id      = module.vpc.vpc_id
  description = "BYOK proxy: outbound 443 only, inbound from VPC"

  # Outbound: TLS only
  egress {
    description = "HTTPS to provider APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Inbound: from VPC private subnets (ECS service)
  ingress {
    description = "From VPC private subnets"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-proxy-sg"
  })
}

# --------------------------------------------------------------------------
# VPC Flow Logs — BYOK Subnet Filter (AC-4.27)
# --------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "byok_flow_logs" {
  count = var.byok_enabled ? 1 : 0

  name              = "/aws/vpc-flow-logs/${local.name_prefix}-byok"
  retention_in_days = 90

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-flow-logs"
  })
}

resource "aws_iam_role" "byok_flow_logs" {
  count = var.byok_enabled ? 1 : 0

  name = "${local.name_prefix}-byok-flow-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "vpc-flow-logs.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "byok_flow_logs" {
  count = var.byok_enabled ? 1 : 0

  name = "${local.name_prefix}-byok-flow-logs-policy"
  role = aws_iam_role.byok_flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Effect   = "Allow"
      Resource = "${aws_cloudwatch_log_group.byok_flow_logs[0].arn}:*"
    }]
  })
}

resource "aws_flow_log" "byok_subnet" {
  count = var.byok_enabled ? length(var.availability_zones) : 0

  subnet_id        = aws_subnet.byok_proxy[count.index].id
  traffic_type     = "REJECT"
  iam_role_arn     = aws_iam_role.byok_flow_logs[0].arn
  log_destination  = aws_cloudwatch_log_group.byok_flow_logs[0].arn
  log_format       = "$${version} $${account-id} $${interface-id} $${srcaddr} $${dstaddr} $${srcport} $${dstport} $${protocol} $${packets} $${bytes} $${start} $${end} $${action} $${log-status}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-flow-log-${var.availability_zones[count.index]}"
  })
}

# --------------------------------------------------------------------------
# CloudWatch Alarms — BYOK Egress Deny (AC-4.27)
# --------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "byok_firewall_deny" {
  count = var.byok_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-byok-firewall-deny"
  alarm_description   = "BYOK Network Firewall denied egress traffic across ALL AZs — potential SSRF attempt (BB3-3)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  treat_missing_data  = "notBreaching"

  # Metric math: SUM DroppedPackets across all AZs (BB3-3)
  # AWS Network Firewall emits metrics per-AZ, unlike ALB which aggregates.
  # Using metric math ensures SSRF attempts from any AZ trigger the alarm.
  dynamic "metric_query" {
    for_each = var.availability_zones
    content {
      id = "az_${replace(metric_query.value, "-", "_")}"
      metric {
        metric_name = "DroppedPackets"
        namespace   = "AWS/NetworkFirewall"
        period      = 300
        stat        = "Sum"
        dimensions = {
          FirewallName     = aws_networkfirewall_firewall.byok[0].name
          AvailabilityZone = metric_query.value
        }
      }
    }
  }

  metric_query {
    id          = "total_drops"
    expression  = join("+", [for az in var.availability_zones : "az_${replace(az, "-", "_")}"])
    label       = "Total Dropped Packets Across AZs"
    return_data = true
  }

  alarm_actions = var.sns_alarm_topic_arn != "" ? [var.sns_alarm_topic_arn] : []

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-byok-firewall-deny-alarm"
  })
}

# --------------------------------------------------------------------------
# Outputs
# --------------------------------------------------------------------------

output "byok_proxy_subnet_ids" {
  description = "BYOK proxy subnet IDs for ECS task placement"
  value       = var.byok_enabled ? aws_subnet.byok_proxy[*].id : []
}

output "byok_proxy_security_group_id" {
  description = "BYOK proxy security group ID"
  value       = var.byok_enabled ? aws_security_group.byok_proxy[0].id : null
}

output "byok_firewall_arn" {
  description = "BYOK Network Firewall ARN"
  value       = var.byok_enabled ? aws_networkfirewall_firewall.byok[0].arn : null
}
