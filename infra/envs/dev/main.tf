provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "guruji"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

module "stack" {
  source = "../../modules/app-stack"

  project             = "guruji"
  env                 = "dev"
  api_source_dir      = "${path.module}/../../../services/api"
  app_origins         = var.app_origins
  enable_frontend     = var.enable_frontend
  deletion_protection = false # dev can be torn down freely
  alert_email         = var.alert_email
  budget_limit_usd    = var.budget_limit_usd
}
