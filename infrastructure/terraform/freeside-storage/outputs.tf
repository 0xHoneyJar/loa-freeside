# =============================================================================
# freeside-storage — Outputs
# =============================================================================

output "cloudfront_distribution_id" {
  description = "ID of the new CloudFront distribution"
  value       = aws_cloudfront_distribution.main.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the new CloudFront distribution. Use for bucket-policy OAC grant."
  value       = aws_cloudfront_distribution.main.arn
}

output "cloudfront_distribution_domain" {
  description = "Auto-generated CloudFront domain (e.g. d1234abcd.cloudfront.net). Target for the Route53 alias record."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront's hosted zone ID. Required for the Route53 alias record."
  value       = aws_cloudfront_distribution.main.hosted_zone_id
}

output "alias_fqdn" {
  description = "Custom domain alias for the new distribution"
  value       = var.alias_fqdn
}

output "acm_certificate_arn" {
  description = "ARN of the ACM cert in us-east-1"
  value       = aws_acm_certificate.alias.arn
}

output "acm_validation_records" {
  description = "DNS validation records to create MANUALLY in Route53. Each entry: { name, type, value }. Operator creates these in the console; cert moves to ISSUED."
  value = [
    for o in aws_acm_certificate.alias.domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ]
}

output "backing_bucket_name" {
  description = "Existing S3 bucket the distribution reads from"
  value       = data.aws_s3_bucket.backing.bucket
}

output "backing_bucket_arn" {
  description = "ARN of the backing bucket (for reference; bucket policy update is manual)"
  value       = data.aws_s3_bucket.backing.arn
}

output "oac_id" {
  description = "Origin Access Control ID. Required when authoring the bucket policy OAC grant."
  value       = aws_cloudfront_origin_access_control.s3_oac.id
}
