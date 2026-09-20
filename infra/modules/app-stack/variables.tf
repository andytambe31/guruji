variable "project" {
  type    = string
  default = "guruji"
}

variable "env" {
  description = "Environment name (dev | prod)."
  type        = string
}

variable "api_source_dir" {
  description = "Path to the Lambda API source directory (relative to the env root)."
  type        = string
}

variable "app_origins" {
  description = "Web origins for CORS + Cognito callback/logout (e.g. the CloudFront/Pages URL)."
  type        = list(string)
  default     = []
}

variable "cognito_domain_prefix" {
  description = "Cognito Hosted UI domain prefix (globally unique). Empty = none."
  type        = string
  default     = ""
}

variable "enable_frontend" {
  description = "Provision S3 + CloudFront to host the PWA on AWS (vs staying on GitHub Pages)."
  type        = bool
  default     = true
}

variable "frontend_domain_aliases" {
  type    = list(string)
  default = []
}

variable "frontend_acm_certificate_arn" {
  type    = string
  default = ""
}

variable "deletion_protection" {
  description = "DynamoDB deletion protection (true in prod)."
  type        = bool
  default     = true
}

variable "allowed_subs" {
  description = "Cognito subject IDs allowed past the app authz gate. The strong single-user allow-list."
  type        = list(string)
  default     = []
}

variable "allowed_emails" {
  description = "Emails allowed past the app authz gate (case-insensitive). Alternative/addition to allowed_subs."
  type        = list(string)
  default     = []
}

variable "require_allowlist" {
  description = "Fail closed: reject every principal when no allow-list is configured, rather than admitting any pool member."
  type        = bool
  default     = true
}

variable "alert_email" {
  type    = string
  default = ""
}

variable "budget_limit_usd" {
  type    = number
  default = 10
}

variable "tags" {
  type    = map(string)
  default = {}
}
