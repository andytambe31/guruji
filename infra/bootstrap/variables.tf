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
  description = "Branches allowed to assume the CI role via OIDC (sub claim). Use ['*'] to allow any ref."
  type        = list(string)
  default     = ["main"]
}

variable "tags" {
  description = "Common tags applied to bootstrap resources."
  type        = map(string)
  default     = {}
}
