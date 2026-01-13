# Arrakis Terraform Policy Rules
#
# OPA (Open Policy Agent) policies for validating Terraform infrastructure changes
# before they reach human review.
#
# Hard Blocks: Violations that auto-reject without human override
# Warnings: Violations that require human review but can be approved

package terraform.arrakis

import future.keywords.contains
import future.keywords.if
import future.keywords.in

# Main decision point
default allow := false

allow if {
    count(hard_blocks) == 0
}

# === HARD BLOCK RULES (Auto-Reject) ===

# Hard block: Deleting PersistentVolume or PersistentVolumeClaim
hard_blocks contains violation if {
    some change in input.resource_changes
    change.type in ["kubernetes_persistent_volume", "kubernetes_persistent_volume_claim"]
    "delete" in change.change.actions
    violation := {
        "code": "HARD_BLOCK_DELETE_PV",
        "severity": "critical",
        "message": "Deletion of PersistentVolume or PersistentVolumeClaim is not allowed",
        "resource": change.address,
        "canOverride": false,
        "details": {
            "type": change.type,
            "reason": "Data loss risk - persistent volumes contain critical application data"
        }
    }
}

# Hard block: Deleting database instances
hard_blocks contains violation if {
    some change in input.resource_changes
    change.type in [
        "aws_db_instance",
        "aws_rds_cluster",
        "aws_rds_cluster_instance",
        "postgresql_database"
    ]
    "delete" in change.change.actions
    violation := {
        "code": "HARD_BLOCK_DELETE_DATABASE",
        "severity": "critical",
        "message": "Deletion of database resources is not allowed",
        "resource": change.address,
        "canOverride": false,
        "details": {
            "type": change.type,
            "reason": "Data loss risk - databases contain critical application data"
        }
    }
}

# Hard block: Disabling Row-Level Security (RLS)
hard_blocks contains violation if {
    some change in input.resource_changes
    change.type == "postgresql_table"
    change.change.before.row_security_enabled == true
    change.change.after.row_security_enabled == false
    violation := {
        "code": "HARD_BLOCK_DISABLE_RLS",
        "severity": "critical",
        "message": "Disabling Row-Level Security is not allowed",
        "resource": change.address,
        "canOverride": false,
        "details": {
            "type": change.type,
            "reason": "Security vulnerability - RLS provides multi-tenant data isolation"
        }
    }
}

# Hard block: Deleting production namespace
hard_blocks contains violation if {
    some change in input.resource_changes
    change.type == "kubernetes_namespace"
    "delete" in change.change.actions
    change.change.before.metadata[0].name in ["production", "prod", "arrakis-production"]
    violation := {
        "code": "HARD_BLOCK_DELETE_PROD_NAMESPACE",
        "severity": "critical",
        "message": "Deletion of production namespace is not allowed",
        "resource": change.address,
        "canOverride": false,
        "details": {
            "type": change.type,
            "namespace": change.change.before.metadata[0].name,
            "reason": "Would destroy entire production environment"
        }
    }
}

# Hard block: Deleting Vault policies or roles
hard_blocks contains violation if {
    some change in input.resource_changes
    change.type in ["vault_policy", "vault_auth_backend_role", "vault_token_auth_backend_role"]
    "delete" in change.change.actions
    violation := {
        "code": "HARD_BLOCK_DELETE_VAULT_POLICY",
        "severity": "critical",
        "message": "Deletion of Vault policies/roles is not allowed",
        "resource": change.address,
        "canOverride": false,
        "details": {
            "type": change.type,
            "reason": "Security risk - would revoke cryptographic access"
        }
    }
}

# === WARNING RULES (Require Human Review) ===

# Warning: High-risk resource modifications
warnings contains violation if {
    some change in input.resource_changes
    change.type in [
        "aws_eks_cluster",
        "aws_vpc",
        "aws_security_group",
        "aws_iam_role",
        "aws_iam_policy"
    ]
    "update" in change.change.actions
    violation := {
        "code": "WARN_HIGH_RISK_UPDATE",
        "severity": "high",
        "message": sprintf("High-risk resource update detected: %s", [change.type]),
        "resource": change.address,
        "canOverride": true,
        "details": {
            "type": change.type,
            "reason": "Changes to critical infrastructure require careful review"
        }
    }
}

# Warning: Large-scale modifications
warnings contains violation if {
    count(input.resource_changes) >= 10
    violation := {
        "code": "WARN_LARGE_BLAST_RADIUS",
        "severity": "high",
        "message": sprintf("Large blast radius: %d resources affected", [count(input.resource_changes)]),
        "resource": "multiple",
        "canOverride": true,
        "details": {
            "resourceCount": count(input.resource_changes),
            "reason": "Large changes increase risk of unexpected side effects"
        }
    }
}

# Warning: Replacing resources (delete-then-create)
warnings contains violation if {
    some change in input.resource_changes
    "delete" in change.change.actions
    "create" in change.change.actions
    violation := {
        "code": "WARN_RESOURCE_REPLACEMENT",
        "severity": "medium",
        "message": sprintf("Resource replacement detected: %s", [change.address]),
        "resource": change.address,
        "canOverride": true,
        "details": {
            "type": change.type,
            "reason": "Replacement may cause temporary service disruption"
        }
    }
}

# Warning: Creating new production resources
warnings contains violation if {
    some change in input.resource_changes
    "create" in change.change.actions
    change.type in ["aws_db_instance", "aws_rds_cluster", "aws_eks_cluster"]
    violation := {
        "code": "WARN_NEW_CRITICAL_RESOURCE",
        "severity": "medium",
        "message": sprintf("New critical resource creation: %s", [change.type]),
        "resource": change.address,
        "canOverride": true,
        "details": {
            "type": change.type,
            "reason": "New critical infrastructure should be reviewed for cost and necessity"
        }
    }
}

# Warning: Modifying Redis or queue infrastructure
warnings contains violation if {
    some change in input.resource_changes
    change.type in ["aws_elasticache_cluster", "aws_elasticache_replication_group"]
    change.change.actions != ["no-op"]
    violation := {
        "code": "WARN_QUEUE_INFRASTRUCTURE_CHANGE",
        "severity": "high",
        "message": "Redis/cache infrastructure change detected",
        "resource": change.address,
        "canOverride": true,
        "details": {
            "type": change.type,
            "reason": "Changes to Redis may affect sessions, queues, and token bucket"
        }
    }
}

# Warning: Security group rule changes
warnings contains violation if {
    some change in input.resource_changes
    change.type in ["aws_security_group_rule", "aws_security_group"]
    change.change.after.ingress != change.change.before.ingress
    violation := {
        "code": "WARN_SECURITY_GROUP_CHANGE",
        "severity": "high",
        "message": "Security group ingress rules modified",
        "resource": change.address,
        "canOverride": true,
        "details": {
            "type": change.type,
            "reason": "Network security changes require careful review"
        }
    }
}

# === HELPER FUNCTIONS ===

# Check if a resource is in a production environment
is_production_resource(resource) if {
    resource.change.after.tags.Environment == "production"
}

is_production_resource(resource) if {
    contains(resource.address, "prod")
}

# Check if a resource change is destructive
is_destructive(resource) if {
    "delete" in resource.change.actions
}

# Count resources by action type
count_by_action(action) := count if {
    count := count([r | r := input.resource_changes[_]; action in r.change.actions])
}
