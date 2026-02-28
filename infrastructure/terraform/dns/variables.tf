# =============================================================================
# DNS Root — Variables
# Cycle 046: Armitage Platform — Sprint 3
# SDD §7.2: dns/variables.tf
# =============================================================================

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type = string
}

variable "domain" {
  type    = string
  default = "0xhoneyjar.xyz"
}

variable "vercel_anycast_ip" {
  type        = string
  default     = "76.76.21.21"
  description = "Vercel anycast IP for A records (per Vercel docs for custom domains)"
}

variable "vercel_cname" {
  type    = string
  default = "cname.vercel-dns.com"
}

variable "google_workspace_mx" {
  type = list(object({
    priority = number
    value    = string
  }))
  default = [
    { priority = 1, value = "aspmx.l.google.com" },
    { priority = 5, value = "alt1.aspmx.l.google.com" },
    { priority = 5, value = "alt2.aspmx.l.google.com" },
    { priority = 10, value = "alt3.aspmx.l.google.com" },
    { priority = 10, value = "alt4.aspmx.l.google.com" }
  ]
}

variable "dkim_key" {
  type        = string
  default     = ""
  description = "Google Workspace DKIM public key (retrieve from Admin Console)"
  sensitive   = true
}

variable "enable_production_api" {
  type        = bool
  default     = false
  description = "Create api.0xhoneyjar.xyz alias to compute ALB"
}

variable "enable_dnssec" {
  type        = bool
  default     = false
  description = "Enable DNSSEC signing for the zone"
}

# IMP-008: Feature flag safety guardrails
# Environment-specific defaults prevent accidental production enablement.
# Staging tfvars: enable_production_api = true, enable_dnssec = true
# Production tfvars: enable_production_api = false, enable_dnssec = false (until cutover)
# CI lint rule: production tfvars must NOT set enable_dnssec=true without matching
# DS record upload confirmation in DEPLOYMENT.md checklist.

variable "dmarc_email" {
  type    = string
  default = "dmarc@0xhoneyjar.xyz"
}
