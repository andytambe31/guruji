variable "project" {
  description = "Project slug, used to name/prefix resources."
  type        = string
  default     = "guruji"
}

variable "region" {
  description = "AWS region for the Terraform state bucket + lock table."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform remote state. Must be set (bucket names are global)."
  type        = string
}

variable "lock_table_name" {
  description = "DynamoDB table name for Terraform state locking."
  type        = string
  default     = "guruji-tf-locks"
}

variable "github_owner" {
  description = "GitHub org/user that owns the repo allowed to assume the CI role."
  type        = string
  default     = "andytambe31"
}

variable "github_repo" {
  description = "GitHub repository name (without owner)."
  type        = string
  default     = "guruji"
}

variable "github_branches" {
  description = "Branches allowed to assume the CI role via OIDC (sub claim). Use ['*'] to allow any ref (discouraged — also lets fork PR workflows assume it)."
  type        = list(string)
  default     = ["main"]

  validation {
    condition     = length(var.github_branches) > 0
    error_message = "github_branches must list at least one branch (or [\"*\"]); an empty list would leave the trust policy with no way to assume the role."
  }
}

variable "tags" {
  description = "Common tags applied to bootstrap resources."
  type        = map(string)
  default     = {}
}

variable "use_power_user_access" {
  description = <<-EOT
    Escape hatch. When false (the default), the CI role gets a least-privilege
    deploy policy scoped to ONLY the services + resource ARNs these stacks
    manage — a leaked credential can't reach EC2/RDS/IAM-users/billing/etc.
    Set true to fall back to the broad AWS-managed PowerUserAccess (admin minus
    IAM) if a future resource type isn't yet covered by the scoped policy.
  EOT
  type        = bool
  default     = false
}
