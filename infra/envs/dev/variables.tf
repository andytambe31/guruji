variable "region" {
  type    = string
  default = "us-east-1"
}

variable "app_origins" {
  description = "Web origins for CORS + Cognito (e.g. https://andytambe31.github.io)."
  type        = list(string)
  default     = []
}

variable "enable_frontend" {
  description = "Host the PWA on S3+CloudFront in dev too."
  type        = bool
  default     = false
}

variable "alert_email" {
  type    = string
  default = ""
}

variable "budget_limit_usd" {
  type    = number
  default = 5
}
