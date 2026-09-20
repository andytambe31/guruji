provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "guruji"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

module "stack" {
  source = "../../modules/app-stack"

  project                      = "guruji"
  env                          = "prod"
  api_source_dir               = "${path.module}/../../../services/api"
  app_origins                  = var.app_origins
  enable_frontend              = var.enable_frontend
  frontend_domain_aliases      = var.frontend_domain_aliases
  frontend_acm_certificate_arn = var.frontend_acm_certificate_arn
  cognito_domain_prefix        = var.cognito_domain_prefix
  deletion_protection          = true
  alert_email                  = var.alert_email
  budget_limit_usd             = var.budget_limit_usd
}
