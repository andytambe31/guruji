output "state_bucket" {
  description = "S3 bucket holding Terraform remote state. Put this in each env's backend.hcl."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "DynamoDB table for state locking. Put this in each env's backend.hcl."
  value       = aws_dynamodb_table.locks.name
}

output "ci_role_arn" {
  description = "IAM role ARN for GitHub Actions to assume via OIDC. Set as the AWS_ROLE_ARN repo variable / secret."
  value       = aws_iam_role.ci.arn
}

output "github_oidc_provider_arn" {
  description = "The GitHub OIDC provider ARN."
  value       = aws_iam_openid_connect_provider.github.arn
}
